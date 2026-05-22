// Smoke test for tts.js. Run: node --env-file=.env src/tts.smoke.js
import { synthesize, ttsConfigured, TTS_CACHE_DIR } from "./tts.js";

if (!ttsConfigured()) {
  console.error("[smoke] FISH_AUDIO_KEY not set in .env");
  process.exit(1);
}

const text = process.argv.slice(2).join(" ") || "你好,我是 Fishio,这是一段测试。";
console.log(`[smoke] synthesizing: ${text}`);
const t0 = Date.now();
try {
  const r = await synthesize(text);
  const ms = Date.now() - t0;
  if (!r) console.log("[smoke] no result (key missing?)");
  else    console.log(`[smoke] ok in ${ms}ms — ${r.cached ? "cache hit" : `${r.bytes} bytes`} → ${TTS_CACHE_DIR}\\${r.hash}.mp3 (served at ${r.url})`);
} catch (e) {
  console.error(`[smoke] FAILED:`, e.message);
  if (e.body) console.error("[smoke] body:", e.body);
}
