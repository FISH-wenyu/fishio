// tts.js — ElevenLabs text-to-speech.
// POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id> with the
// `eleven_multilingual_v2` model returns binary mp3. We cache by sha256
// (text|voice|model) under cache/tts/, so the same line is only synthesized
// once. Returns a /tts/<hash>.mp3 URL served by our HTTP server.
//
// The router / stream / frontend never see the provider — keep the public
// surface (synthesize, ttsConfigured, TTS_CACHE_DIR) stable so we can swap
// providers again without touching anything else.
import { writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TTS_CACHE_DIR = join(__dirname, "..", "cache", "tts");

const KEY      = process.env.ELEVENLABS_API_KEY || "";
// Rachel is the classic default ElevenLabs starter voice; available on free tier.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MODEL    = process.env.ELEVENLABS_MODEL    || "eleven_multilingual_v2";

const STABILITY   = num(process.env.ELEVENLABS_STABILITY,   0.5);
const SIMILARITY  = num(process.env.ELEVENLABS_SIMILARITY,  0.75);
const STYLE       = num(process.env.ELEVENLABS_STYLE,       0.0);

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

class TTSError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "TTSError";
    this.status = status;
    this.body = body;
  }
}

export function ttsConfigured() { return !!KEY; }

function hash(text) {
  return createHash("sha256")
    .update(text + "|" + VOICE_ID + "|" + MODEL)
    .digest("hex")
    .slice(0, 32);
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Synthesize a line. Returns { url, hash, cached, bytes } or null if no key.
 * Throws TTSError on API failure — caller decides whether to swallow.
 */
export async function synthesize(text) {
  if (!KEY) return null;
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  await mkdir(TTS_CACHE_DIR, { recursive: true });
  const h = hash(trimmed);
  const file = join(TTS_CACHE_DIR, `${h}.mp3`);
  if (await exists(file)) {
    return { url: `/tts/${h}.mp3`, hash: h, cached: true };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}`;
  const body = {
    text: trimmed,
    model_id: MODEL,
    voice_settings: {
      stability: STABILITY,
      similarity_boost: SIMILARITY,
      style: STYLE,
      use_speaker_boost: true,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new TTSError(`elevenlabs ${res.status}`, { status: res.status, body: txt.slice(0, 400) });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) {
    throw new TTSError(`response too small (${buf.length} bytes)`, { body: buf.toString("utf8") });
  }
  await writeFile(file, buf);
  return { url: `/tts/${h}.mp3`, hash: h, cached: false, bytes: buf.length };
}

export { TTSError };
