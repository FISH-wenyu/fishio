// src/claude.js — backward-compatible shim. The brain layer was split into
// src/brains/* so we can route between Claude / DeepSeek / future providers
// without touching router.js. Keep this file thin; new code should import
// directly from ./brains/index.js.
export { ask, BrainError, BrainError as ClaudeError, brainStatus } from "./brains/index.js";
