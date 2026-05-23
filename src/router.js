// router.js — decide whether a turn is small-talk that should go to the brain,
// or a direct command we can short-circuit. For the MVP everything goes to the
// brain; this layer is here so the seam exists when ncm direct-search lands.
import { buildPrompt } from "./context.js";
import { ask, ClaudeError } from "./claude.js";
import { appendMessage, enqueueAll, isBlacklisted, getQueue } from "./state.js";
import { resolveQueries } from "./ncm.js";
import { synthesize as ttsSynthesize, ttsConfigured } from "./tts.js";
import { bus } from "./events.js";
import { fillFromLibrary } from "./library.js";

async function safeTts(text) {
  if (!ttsConfigured() || !text) return null;
  try {
    return await ttsSynthesize(text);
  } catch (e) {
    console.error("[tts] synth failed:", e.message, e.body ? `→ ${e.body}` : "");
    return null;
  }
}

// Very small heuristic — true direct commands (`/skip`, `/pause`, …) can be
// added here later. For now we only branch on the leading slash.
function isSlashCommand(text) {
  return typeof text === "string" && text.trimStart().startsWith("/");
}

function handleSlash(text) {
  const cmd = text.trim().toLowerCase();
  // placeholders — real impls come when we wire the player
  if (cmd === "/skip")  return { say: "好,跳过这首。", play: [], reason: "user /skip", segue: "" };
  if (cmd === "/pause") return { say: "暂停。", play: [], reason: "user /pause", segue: "" };
  return { say: `还不认识这条指令:${cmd}`, play: [], reason: "unknown slash command", segue: "" };
}

/**
 * Route one turn from the user.
 *   input:   string
 *   trigger: "user" | "schedule" | "system"
 */
export async function route({ input, trigger = "user" }) {
  if (!input || !input.trim()) {
    return { say: "(空输入)", play: [], reason: "empty input", segue: "" };
  }

  if (trigger === "user") appendMessage("user", input);

  if (isSlashCommand(input)) {
    const out = handleSlash(input);
    if (out.say) appendMessage("dj", out.say);
    return out;
  }

  const prompt = await buildPrompt({ trigger, input });
  try {
    const out = await ask(prompt);
    if (out.say) appendMessage("dj", out.say); // fires "say" event immediately

    // Run TTS synthesis and NCM lookups in parallel. We emit "tts" BEFORE
    // "enqueue" so the client can play the voice line first and only start
    // music when the voice finishes.
    const queries = out.play.map(p => p.query);
    const [ttsResult, resolved] = await Promise.all([
      safeTts(out.say),
      queries.length ? resolveQueries(queries) : Promise.resolve([]),
    ]);

    if (ttsResult) bus.emit("tts", { url: ttsResult.url, text: out.say });

    let enqueuedCount = 0;
    if (resolved.length) {
      resolved.forEach((r, i) => { r.reason = out.play[i]?.reason || ""; });
      // Drop anything the listener has blacklisted as a defensive net — the
      // brain has the list in context but may still slip occasionally.
      const playable = resolved
        .filter(r => r.url)
        .filter(r => !isBlacklisted(r));
      if (playable.length) {
        await enqueueAll(playable);
        enqueuedCount = playable.length;
      }
    }
    // If the brain gave us queries but NCM resolved 0 to a playable URL
    // (rate limit, TLS failure, copyright nulls), fall back to the local
    // library so the listener still gets music for this turn.
    if (out.play.length > 0 && enqueuedCount === 0) {
      console.warn(`[router] NCM resolved 0 of ${out.play.length} — library fallback`);
      const got = await fillFromLibrary(Math.max(3, out.play.length));
      console.log(`[router] library fallback added ${got} tracks`);
    }
    return { ...out, play: resolved, tts_url: ttsResult?.url || null };
  } catch (err) {
    if (err instanceof ClaudeError) {
      console.error("[router] brain failed:", err.message);
      if (err.raw)    console.error("[router] raw:", err.raw.slice(0, 500));
      if (err.stderr) console.error("[router] stderr:", err.stderr.slice(0, 500));
    } else {
      console.error("[router] unexpected:", err);
    }
    return {
      // For autopilot we stay silent (no DJ apology); for human chat we hint.
      say: trigger === "autopilot" ? "" : "Sorry, I missed that. Try again?",
      play: [],
      reason: `brain error: ${err.message}`,
      segue: "",
    };
  }
}
