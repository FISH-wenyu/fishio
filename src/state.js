// state.js — minimal JSON-file persistence for messages / plays / prefs.
// Interface kept narrow so we can swap to sqlite later without touching callers.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bus } from "./events.js";
import { refreshUrl } from "./ncm.js";

// NCM stream URLs are signed and expire within ~30 minutes. Refresh anything
// older than this threshold the moment we hand it to the player.
const URL_TTL_MS = 25 * 60 * 1000;

// Below this remaining-queue size, emit "queue-low" so autopilot can refill
// before the listener feels a gap.
const QUEUE_LOW_WATERMARK = 2;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");
const STATE_FILE = join(STATE_DIR, "state.json");

const DEFAULTS = {
  messages: [],   // { role: "user"|"dj", text, ts }
  plays: [],      // { query, song_id?, name, artists, played_at }
  prefs: {},      // free-form k/v from user
  plan: null,     // today's plan, set by scheduler
  current: null,  // currently playing track (or null)
  queue: [],      // upcoming tracks
};

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!existsSync(STATE_FILE)) return structuredClone(DEFAULTS);
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch (e) {
    console.warn("[state] corrupt state file, starting fresh:", e.message);
    return structuredClone(DEFAULTS);
  }
}

let cache = load();

function persist() {
  ensureDir();
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  renameSync(tmp, STATE_FILE);
}

export function getMessages(limit = 20) {
  return cache.messages.slice(-limit);
}

export function appendMessage(role, text) {
  cache.messages.push({ role, text, ts: Date.now() });
  if (cache.messages.length > 500) cache.messages = cache.messages.slice(-500);
  persist();
  if (role === "dj") bus.emit("say", { text });
}

/** Wipe the chat history (does NOT touch favorites / blacklist / plays / queue). */
export function clearMessages() {
  cache.messages = [];
  persist();
  bus.emit("history-cleared");
}

export function getPlays(limit = 30) {
  return cache.plays.slice(-limit);
}

export function appendPlay(entry) {
  cache.plays.push({ ...entry, played_at: Date.now() });
  if (cache.plays.length > 1000) cache.plays = cache.plays.slice(-1000);
  persist();
}

export function getPrefs() {
  return { ...cache.prefs };
}

export function setPref(key, value) {
  cache.prefs[key] = value;
  persist();
}

export function getPlan() {
  return cache.plan;
}

export function setPlan(plan) {
  cache.plan = plan;
  persist();
}

export function getCurrent() {
  return cache.current;
}

export function getQueue() {
  return [...cache.queue];
}

async function promote(track) {
  // Refresh the URL just-in-time so we never hand the player a stale stream
  // (NCM signs URLs with a ~30 min validity window).
  const fresh = track.id ? await refreshUrl(track.id) : null;
  return {
    ...track,
    url: fresh || track.url,
    url_at: Date.now(),
    started_at: Date.now(),
  };
}

export async function enqueueAll(tracks) {
  for (const t of tracks) cache.queue.push(t);
  // if nothing is playing, immediately promote the first item to current
  if (!cache.current && cache.queue.length) {
    cache.current = await promote(cache.queue.shift());
    appendPlay({ query: cache.current.query, name: cache.current.name, artists: cache.current.artists });
  }
  persist();
  bus.emit("enqueue", { tracks, current: cache.current });
}

/** Advance the queue: pop next item to current, return the new current (or null). */
export async function advance() {
  if (cache.queue.length === 0) {
    cache.current = null;
  } else {
    cache.current = await promote(cache.queue.shift());
    appendPlay({ query: cache.current.query, name: cache.current.name, artists: cache.current.artists });
  }
  persist();
  bus.emit("advance", { current: cache.current });
  // After advance, if the upcoming queue is too thin, signal autopilot.
  if (cache.current && cache.queue.length < QUEUE_LOW_WATERMARK) {
    bus.emit("queue-low", { queueLength: cache.queue.length });
  }
  return cache.current;
}

/** Jump directly to queue[index] — items before it are skipped (dropped). */
export async function jumpTo(index) {
  if (!Number.isInteger(index) || index < 0 || index >= cache.queue.length) {
    return cache.current;
  }
  // drop everything before the target
  cache.queue.splice(0, index);
  cache.current = await promote(cache.queue.shift());
  appendPlay({ query: cache.current.query, name: cache.current.name, artists: cache.current.artists });
  persist();
  bus.emit("advance", { current: cache.current });
  return cache.current;
}

/** Move queue[from] to position `to`. No-op for invalid indices. */
export function moveQueueItem(from, to) {
  const q = cache.queue;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from >= q.length || to < 0 || to >= q.length) return false;
  if (from === to) return false;
  const [item] = q.splice(from, 1);
  q.splice(to, 0, item);
  persist();
  bus.emit("enqueue", { tracks: [], current: cache.current });
  return true;
}

/** Remove queue[index]. */
export function removeQueueItem(index) {
  if (!Number.isInteger(index) || index < 0 || index >= cache.queue.length) return false;
  cache.queue.splice(index, 1);
  persist();
  bus.emit("enqueue", { tracks: [], current: cache.current });
  return true;
}

// ── Library: favorites + blacklist ───────────────────────────────────────
// Stored under prefs so they survive restart. We keep light metadata so we
// don't have to re-query NCM just to render the lists.

function _list(name) {
  const arr = cache.prefs[name];
  return Array.isArray(arr) ? arr : [];
}
function _setList(name, arr) {
  cache.prefs[name] = arr;
  persist();
  bus.emit("library", { favorites: _list("favorites"), blacklist: _list("blacklist") });
}

function _trackKey(t) {
  // prefer id if present (stable across queries), else fall back to query.
  return t && (t.id != null ? `id:${t.id}` : `q:${t.query || t.name || ""}`);
}

function _summary(t) {
  return {
    id:      t.id || null,
    name:    t.name || t.query || "(unknown)",
    artists: t.artists || [],
    query:   t.query || (t.name && t.artists?.length ? `${t.name} - ${t.artists[0]}` : (t.name || "")),
    ts:      Date.now(),
  };
}

export function getFavorites()  { return _list("favorites"); }
export function getBlacklist()  { return _list("blacklist"); }

export function isFavorite(track) {
  if (!track) return false;
  const k = _trackKey(track);
  return _list("favorites").some(x => _trackKey(x) === k);
}

export function isBlacklisted(track) {
  if (!track) return false;
  const k = _trackKey(track);
  return _list("blacklist").some(x => _trackKey(x) === k);
}

export function addFavorite(track) {
  if (!track) return false;
  if (isFavorite(track)) return false;
  _setList("favorites", [..._list("favorites"), _summary(track)]);
  return true;
}

export function removeFavorite(track) {
  if (!track) return false;
  const k = _trackKey(track);
  const next = _list("favorites").filter(x => _trackKey(x) !== k);
  if (next.length === _list("favorites").length) return false;
  _setList("favorites", next);
  return true;
}

export function addToBlacklist(track) {
  if (!track) return false;
  if (isBlacklisted(track)) return false;
  _setList("blacklist", [..._list("blacklist"), _summary(track)]);
  return true;
}

export function removeFromBlacklist(track) {
  if (!track) return false;
  const k = _trackKey(track);
  const next = _list("blacklist").filter(x => _trackKey(x) !== k);
  if (next.length === _list("blacklist").length) return false;
  _setList("blacklist", next);
  return true;
}

/**
 * Return the current track, refreshing its stream URL if it has gone stale
 * OR if it's still http:// (which mobile / public HTTPS pages block as mixed
 * content — see ncm.js toHttps). The refresher returns https URLs.
 */
export async function currentWithFreshUrl() {
  if (!cache.current || !cache.current.id) return cache.current;
  const age    = Date.now() - (cache.current.url_at || 0);
  const isHttp = cache.current.url && cache.current.url.startsWith("http://");
  if (cache.current.url && age < URL_TTL_MS && !isHttp) return cache.current;
  const fresh = await refreshUrl(cache.current.id);
  if (fresh) {
    cache.current.url = fresh;
    cache.current.url_at = Date.now();
    persist();
  }
  return cache.current;
}

// For tests / dev reset
export function _resetForTest() {
  cache = structuredClone(DEFAULTS);
  persist();
}
