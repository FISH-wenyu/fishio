// Synthesize one line with several voices so the user can pick by ear.
// Usage: node --env-file=.env src/voice-compare.smoke.js
// (We temporarily override ELEVENLABS_VOICE_ID per call, then restore.)
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "..", "cache", "tts");
await mkdir(CACHE, { recursive: true });

const KEY   = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

const LINE  = "晚上好,这是 Fishio,接下来这首歌可能让你想起一些事。";
const VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature, Reassuring, Confident (女)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George - Warm, Captivating Storyteller (男,故事感)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel - Steady Broadcaster (男,主播感)" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian - Deep, Resonant, Comforting (男,深沉)" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda - Knowledgable, Professional (女,知性)" },
];

if (!KEY) { console.error("no key"); process.exit(1); }

async function once(v) {
  const h = createHash("sha256").update(LINE + "|" + v.id + "|" + MODEL).digest("hex").slice(0, 32);
  const out = join(CACHE, `${h}.mp3`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000); // 60s end-to-end
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({
        text: LINE, model_id: MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, err: `${res.status} ${(await res.text()).slice(0,80)}` };
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf);
    return { ok: true, hash: h, bytes: buf.length };
  } catch (e) {
    return { ok: false, err: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

for (const v of VOICES) {
  process.stdout.write(`[${v.name}] `);
  const t0 = Date.now();
  // up to 2 tries — GFW can drop the first connection
  let r = await once(v);
  if (!r.ok) {
    process.stdout.write(`(retry) `);
    r = await once(v);
  }
  if (r.ok) console.log(`${Date.now() - t0}ms · ${r.bytes}b → http://localhost:8080/tts/${r.hash}.mp3`);
  else      console.log(`FAIL ${r.err}`);
}

console.log("\n选一个,把 voice_id 告诉我,我替你把 .env 改了。");
