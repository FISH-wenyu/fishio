// library.js — brain-free fallback song picker.
// Pulls from user/playlists.json + state favorites + recent plays, resolves
// via NCM, and enqueues. Used by autopilot AND by the router whenever the
// brain or NCM can't deliver — so music never stops because Claude rate-
// limited or NetEase's API is having a bad day.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveQueries } from "./ncm.js";
import { enqueueAll, getFavorites, getPlays, getQueue, isBlacklisted } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYLISTS_PATH = join(__dirname, "..", "user", "playlists.json");

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadPool() {
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
    console.error("[library] playlists.json read failed:", e.message);
    return [];
  }
}

/**
 * Pick up to `want` playable songs from local data and enqueue them.
 * Returns how many landed in the queue.
 */
export async function fillFromLibrary(want = 5) {
  const pool = new Set();
  for (const q of loadPool()) pool.add(q);
  for (const f of getFavorites()) { if (f.query) pool.add(f.query); }
  for (const p of getPlays(60)) { if (p.query) pool.add(p.query); }

  const already = new Set(getQueue().map(t => t.query).filter(Boolean));
  const candidates = [...pool].filter(q => {
    if (already.has(q)) return false;
    if (isBlacklisted({ query: q })) return false;
    return true;
  });
  if (candidates.length === 0) {
    console.log("[library] no candidates after dedupe — pool empty or all already queued");
    return 0;
  }

  shuffle(candidates);
  const tryCount = Math.min(candidates.length, want * 3);
  const tries    = candidates.slice(0, tryCount);

  console.log(`[library] trying ${tries.length} candidates for ${want} slots`);
  const resolved = await resolveQueries(tries);
  const playable = resolved.filter(r => r.url).filter(r => !isBlacklisted(r));
  const picks    = playable.slice(0, want).map(r => ({ ...r, reason: "from your library (fallback)" }));
  if (!picks.length) {
    console.log("[library] NCM resolved 0 of", tries.length, "— giving up this cycle");
    return 0;
  }
  await enqueueAll(picks);
  return picks.length;
}
