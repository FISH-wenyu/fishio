// autopilot.js — keep the airwaves alive, even when the brain is down.
//
// Two layers:
//   1. Brain-driven refill: ask Claude for N songs with a strong "exactly 5"
//      prompt and let the router resolve + enqueue them.
//   2. Library fallback: if the brain fails (rate limit, network, etc.) OR
//      returns fewer than MIN_USABLE songs, we pad the queue from the
//      listener's own data — user/playlists.json + state favorites + recent
//      plays — so the music NEVER stops just because Claude is offline.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bus } from "./events.js";
import { route } from "./router.js";
import { resolveQueries } from "./ncm.js";
import { enqueueAll, getFavorites, getPlays, getQueue, isBlacklisted } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYLISTS_PATH = join(__dirname, "..", "user", "playlists.json");

const COOLDOWN_MS   = 12_000;   // small cooldown so multiple low-queue events coalesce
const LOW_WATERMARK = 2;        // refill when queue length drops below this
const REFILL_COUNT  = 5;        // ask the brain for this many songs
const MIN_USABLE    = 3;        // below this from brain → fall back to library

let lastFiredAt = 0;
let inflight    = false;
let runtimeOff  = process.env.AUTOPILOT_OFF === "1";
let started     = false;

const PROMPT = `The queue is running thin. Pick EXACTLY ${REFILL_COUNT} songs (no fewer!) that fit the current time of day, the weather, and what's been played recently. Lean on the listener's anchor artists; avoid anything in the blacklist or already played in the last 30 minutes. Lead with one short DJ line — under 20 words.`;

export function setAutopilotOff(off) { runtimeOff = !!off; }
export function isAutopilotOff()     { return runtimeOff; }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadPlaylistsPool() {
  if (!existsSync(PLAYLISTS_PATH)) return [];
  try {
    const j = JSON.parse(readFileSync(PLAYLISTS_PATH, "utf8")) || {};
    const out = [];
    for (const k of Object.keys(j)) {
      const arr = Array.isArray(j[k]) ? j[k] : [];
      for (const entry of arr) {
        if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
      }
    }
    return out;
  } catch (e) {
    console.error("[autopilot] failed to read playlists.json:", e.message);
    return [];
  }
}

/**
 * Fill the queue from local data — no brain required. Returns how many tracks
 * actually landed in the queue.
 */
async function fillFromLibrary(want) {
  const pool = new Set();
  // 1. user-curated playlists (most intentional)
  for (const q of loadPlaylistsPool()) pool.add(q);
  // 2. tracks the listener has favorited in-app
  for (const f of getFavorites()) { if (f.query) pool.add(f.query); }
  // 3. recent plays as a soft signal
  for (const p of getPlays(60)) { if (p.query) pool.add(p.query); }

  // Avoid: blacklisted, what's already in the queue, what's currently playing
  const already = new Set(getQueue().map(t => t.query).filter(Boolean));
  const candidates = [...pool].filter(q => {
    if (already.has(q)) return false;
    if (isBlacklisted({ query: q })) return false;
    return true;
  });
  if (candidates.length === 0) return 0;

  shuffle(candidates);
  // try up to 3× the desired count so we tolerate NCM misses / copyright nulls
  const tryCount = Math.min(candidates.length, want * 3);
  const tries    = candidates.slice(0, tryCount);

  console.log(`[autopilot] library fallback — trying ${tries.length} candidates for ${want} slots`);
  const resolved = await resolveQueries(tries);
  const playable = resolved.filter(r => r.url).filter(r => !isBlacklisted(r));
  const picks    = playable.slice(0, want).map(r => ({ ...r, reason: "from your library (autopilot fallback)" }));
  if (!picks.length) return 0;
  await enqueueAll(picks);
  return picks.length;
}

async function refill(reason) {
  if (runtimeOff)                              return;
  if (inflight)                                return;       // don't stack while one is in flight
  if (Date.now() - lastFiredAt < COOLDOWN_MS)  return;
  lastFiredAt = Date.now();
  inflight    = true;
  console.log(`[autopilot] refilling — ${reason}`);

  let brainGot = 0;
  try {
    const r = await route({ trigger: "autopilot", input: PROMPT });
    brainGot = (r?.play || []).filter(x => x?.url).length;
    if (r?.reason?.startsWith("brain error")) {
      console.log("[autopilot] brain unavailable:", r.reason);
    } else {
      console.log(`[autopilot] brain delivered ${brainGot} usable songs`);
    }
  } catch (e) {
    console.error("[autopilot] route threw:", e.message);
  }

  if (brainGot < MIN_USABLE) {
    const need = REFILL_COUNT - brainGot;
    const got  = await fillFromLibrary(need);
    console.log(`[autopilot] padded with ${got} from library (wanted ${need})`);
  }
  inflight = false;
}

export function startAutopilot() {
  if (started) return;
  started = true;

  // (a) current became null because queue ran completely dry
  bus.on("advance", ({ current }) => {
    if (current) return;
    refill("queue exhausted (current=null)");
  });

  // (b) queue dropped below the low-water mark while current is still playing
  bus.on("queue-low", ({ queueLength }) => {
    refill(`queue low (${queueLength} < ${LOW_WATERMARK})`);
  });

  // (c) cold start: if there is no current and no queue when the server starts,
  // kick off a refill in the background a couple of seconds in so listeners
  // who land on the page see music shortly.
  setTimeout(() => {
    const q = getQueue();
    if (q.length === 0) refill("cold start (no queue at boot)");
  }, 2500);

  console.log(`[autopilot] running, low-watermark=${LOW_WATERMARK}, cooldown=${COOLDOWN_MS}ms, refill=${REFILL_COUNT}${runtimeOff ? " (currently OFF)" : ""}`);
}
