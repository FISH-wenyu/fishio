// autopilot.js — keep the airwaves alive, even when the brain is down.
//
// Two layers:
//   1. Brain-driven refill: ask Claude for N songs with a strong "exactly 5"
//      prompt and let the router resolve + enqueue them.
//   2. Library fallback (src/library.js): if the brain fails (rate limit,
//      network, etc.) OR delivers fewer than MIN_USABLE songs, we pad the
//      queue from the listener's own data — user/playlists.json + state
//      favorites + recent plays — so the music NEVER stops just because
//      Claude or NCM are offline.
import { bus } from "./events.js";
import { route } from "./router.js";
import { fillFromLibrary } from "./library.js";
import { getQueue } from "./state.js";

const COOLDOWN_MS   = 12_000;   // small cooldown so multiple low-queue events coalesce
const LOW_WATERMARK = 2;        // refill when queue length drops below this
const REFILL_COUNT  = 5;        // ask the brain for this many songs
const MIN_USABLE    = 3;        // below this from brain → fall back to library

let lastFiredAt = 0;
let inflight    = false;
let runtimeOff  = process.env.AUTOPILOT_OFF === "1";
let started     = false;

const PROMPT = `The queue is running thin. Pick EXACTLY ${REFILL_COUNT} FRESH songs (no fewer!) that fit the current time of day, the weather, and what's been played recently.

CRITICAL — NO REPEATS:
- Do NOT pick anything currently in the queue (you'll see the list above).
- Do NOT pick anything played in the last 60 minutes.
- Do NOT pick anything in the blacklist.
- Rotate among the listener's anchor artists — don't keep recommending the same 3 songs.

Lean on variety. Lead with 2-3 sentences referencing the time, weather, or a specific song's story.`;

export function setAutopilotOff(off) { runtimeOff = !!off; }
export function isAutopilotOff()     { return runtimeOff; }

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
