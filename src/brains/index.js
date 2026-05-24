// brains/index.js — provider dispatcher with optional fallback.
//
// .env controls:
//   BRAIN_PROVIDER  = claude | deepseek         (default: claude)
//   BRAIN_FALLBACK  = 1 to also try the OTHER provider on primary failure
//                     (default: 0)
//
// All public callers (router.js, autopilot.js, …) only ever import `ask`
// and `BrainError` from here. Providers themselves never throw anything
// but BrainError, so the dispatcher can introspect `.provider` and
// decide what to log / fall back to.
import { BrainError } from "./common.js";
import { ask as askClaude }   from "./claude.js";
import { ask as askDeepSeek } from "./deepseek.js";

const PROVIDERS = {
  claude:   askClaude,
  deepseek: askDeepSeek,
};

const PRIMARY  = (process.env.BRAIN_PROVIDER || "claude").toLowerCase();
const FALLBACK = process.env.BRAIN_FALLBACK === "1";

function pickSecondary(primary) {
  // explicit override wins, otherwise pick the other one
  const override = (process.env.BRAIN_FALLBACK_PROVIDER || "").toLowerCase();
  if (override && override !== primary && PROVIDERS[override]) return override;
  return primary === "claude" ? "deepseek" : "claude";
}

export async function ask(prompt) {
  const primary = PROVIDERS[PRIMARY];
  if (!primary) {
    throw new BrainError(`unknown BRAIN_PROVIDER=${PRIMARY} (expected: claude | deepseek)`, {
      provider: PRIMARY,
    });
  }

  try {
    return await primary(prompt);
  } catch (err) {
    if (!FALLBACK) throw err;

    const secondary = pickSecondary(PRIMARY);
    const fn = PROVIDERS[secondary];
    if (!fn) throw err;
    console.warn(`[brain] primary ${PRIMARY} failed (${err.message}); falling back to ${secondary}`);

    try {
      const result = await fn(prompt);
      console.warn(`[brain] fallback ${secondary} succeeded`);
      return result;
    } catch (err2) {
      // Both failed — surface the PRIMARY error (it's usually more useful
      // and the listener picked the primary on purpose).
      err.message = `${err.message} | fallback ${secondary} also failed: ${err2.message}`;
      throw err;
    }
  }
}

// Re-export so router.js can `instanceof BrainError` (and the legacy
// `instanceof ClaudeError` keeps working via src/claude.js shim).
export { BrainError };

/** Read-only snapshot for /api/meta and health checks. */
export function brainStatus() {
  return {
    primary:  PRIMARY,
    fallback: FALLBACK ? pickSecondary(PRIMARY) : null,
    claude_configured:   !!process.env.CLAUDE_BIN,
    deepseek_configured: !!process.env.DEEPSEEK_API_KEY,
  };
}
