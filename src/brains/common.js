// brains/common.js — shared types + helpers for brain providers.
// Keep this tiny: anything provider-specific belongs in that provider's file.

/**
 * Unified error every brain provider throws. router.js catches this (and its
 * historical alias ClaudeError) to decide whether to retry, fall back, or
 * surface a "brain offline" hint to the listener.
 */
export class BrainError extends Error {
  constructor(message, { provider, stderr, raw, status, body } = {}) {
    super(message);
    this.name     = "BrainError";
    this.provider = provider;
    this.stderr   = stderr;
    this.raw      = raw;
    this.status   = status;
    this.body     = body;
  }
}

/**
 * Strip ```json ... ``` fences and outer whitespace so JSON.parse can read
 * what the model returned even if it (against persona instructions) wrapped
 * its output.
 */
export function unfence(s) {
  const m = String(s ?? "").match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : String(s ?? "")).trim();
}

/**
 * Coerce whatever the model returned into the strict shape router.js + state.js
 * expect: { say: string, play: [{ query, reason }], reason: string, segue: string }.
 * Drops anything not matching so a slightly malformed model response still
 * yields a playable turn.
 */
export function normalize(p) {
  return {
    say:    typeof p?.say === "string" ? p.say : "",
    play:   Array.isArray(p?.play)
              ? p.play.filter(x => x && typeof x.query === "string")
                       .map(x => ({ query: x.query, reason: x.reason || "" }))
              : [],
    reason: typeof p?.reason === "string" ? p.reason : "",
    segue:  typeof p?.segue === "string" ? p.segue : "",
  };
}
