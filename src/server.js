// server.js — minimal HTTP entry. Six endpoints from the architecture diagram
// will all land here over time. For step 1 we only need POST /api/chat plus
// a /healthz so we can verify the server is breathing.
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { route } from "./router.js";
import {
  getCurrent, getQueue, advance, currentWithFreshUrl,
  jumpTo, moveQueueItem, removeQueueItem,
  getFavorites, getBlacklist, getPlays,
  addFavorite, removeFavorite, isFavorite,
  addToBlacklist, removeFromBlacklist, isBlacklisted,
  clearMessages,
} from "./state.js";
import { startScheduler } from "./scheduler.js";
import { startAutopilot, setAutopilotOff, isAutopilotOff } from "./autopilot.js";
import { attachStream } from "./stream.js";
import { TTS_CACHE_DIR } from "./tts.js";
import { createQr, checkQr, loginStatus, logout, resolveLyric } from "./ncm.js";
import { getSnapshot as getWeather, weatherConfigured } from "./weather.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const app = express();
app.use(express.json({ limit: "256kb" }));
// PWA shell — disable browser cache in development so a code change is picked
// up on a normal refresh (no need for Ctrl+F5).
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"),
}));
// Synthesized voice files are content-addressed by hash, so a long cache is safe.
app.use("/tts", express.static(TTS_CACHE_DIR, { maxAge: "30d", immutable: true }));

app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/api/chat", async (req, res) => {
  const input = typeof req.body?.input === "string" ? req.body.input : "";
  const trigger = req.body?.trigger || "user";
  const t0 = Date.now();
  const out = await route({ input, trigger });
  res.json({ ...out, took_ms: Date.now() - t0 });
});

app.get("/api/now", async (_req, res) => {
  // Refresh URL if the cached one is past its NCM validity window.
  const current = await currentWithFreshUrl();
  res.json({ current });
});

app.get("/api/next", (_req, res) => {
  // peek without advancing — useful for prefetch
  const q = getQueue();
  res.json({ next: q[0] || null, queue_length: q.length });
});

app.post("/api/advance", async (_req, res) => {
  // client says "current song ended, give me next"
  const current = await advance();
  res.json({ current });
});

// /api/skip — alias for advance, clearer intent when the listener triggers it.
app.post("/api/skip", async (_req, res) => {
  const current = await advance();
  res.json({ current });
});

// ── Queue manipulation ────────────────────────────────────────────────────
app.post("/api/queue/jump", async (req, res) => {
  const index = Number(req.body?.index);
  const current = await jumpTo(index);
  res.json({ ok: true, current });
});

app.post("/api/queue/move", (req, res) => {
  const from = Number(req.body?.from);
  const to   = Number(req.body?.to);
  const ok = moveQueueItem(from, to);
  res.json({ ok });
});

app.post("/api/queue/remove", (req, res) => {
  const index = Number(req.body?.index);
  const ok = removeQueueItem(index);
  res.json({ ok });
});

// ── Library: favorite / hide ──────────────────────────────────────────────
// Body may include { id } to act on an arbitrary track; otherwise we act on
// the current playing track. HIDE also advances past the now-hidden track.

function resolveTarget(req) {
  // Body shape: { id?, name?, artists?, query? }. If only id and current
  // matches that id, return current (more metadata). Otherwise build a thin
  // track from whatever was sent.
  const body = req.body || {};
  const cur = getCurrent();
  if (body && Object.keys(body).length) {
    if (cur && body.id && cur.id === body.id) return cur;
    return body;
  }
  return cur;
}

app.post("/api/favorite", (req, res) => {
  const t = resolveTarget(req);
  if (!t) return res.status(400).json({ error: "no target" });
  const added = addFavorite(t);
  res.json({ ok: true, added, isFavorite: isFavorite(t) });
});

app.post("/api/unfavorite", (req, res) => {
  const t = resolveTarget(req);
  if (!t) return res.status(400).json({ error: "no target" });
  const removed = removeFavorite(t);
  res.json({ ok: true, removed, isFavorite: isFavorite(t) });
});

app.post("/api/hide", async (req, res) => {
  const t = resolveTarget(req);
  if (!t) return res.status(400).json({ error: "no target" });
  const added = addToBlacklist(t);
  // If we just hid the song that's playing, advance immediately.
  const cur = getCurrent();
  const wasCurrent = cur && (cur.id === t.id || cur.query === t.query);
  const current = wasCurrent ? await advance() : cur;
  res.json({ ok: true, added, isBlacklisted: isBlacklisted(t), current });
});

app.post("/api/unhide", (req, res) => {
  const t = resolveTarget(req);
  if (!t) return res.status(400).json({ error: "no target" });
  const removed = removeFromBlacklist(t);
  res.json({ ok: true, removed, isBlacklisted: isBlacklisted(t) });
});

app.get("/api/library", (_req, res) => {
  res.json({ favorites: getFavorites(), blacklist: getBlacklist() });
});

// /api/autopilot — runtime control for the auto-refill loop.
app.get("/api/autopilot",  (_req, res) => res.json({ off: isAutopilotOff() }));
app.post("/api/autopilot", (req, res) => {
  setAutopilotOff(!!req.body?.off);
  res.json({ off: isAutopilotOff() });
});

// /api/history/clear — wipe the DJ ↔ listener message log (keeps favorites + blacklist).
app.post("/api/history/clear", (_req, res) => {
  clearMessages();
  res.json({ ok: true });
});

// /api/lyric?id=<song_id> — returns LRC with timestamps stripped for display.
function stripLrcTimestamps(lrc) {
  return String(lrc || "")
    .split("\n")
    .map(line => line.replace(/\[[\d:.]+\]/g, "").trim())
    .filter(Boolean)
    .join("\n");
}
app.get("/api/lyric", async (req, res) => {
  const id = Number(req.query.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id required" });
  const raw = await resolveLyric(id);
  res.json({ id, lyric: stripLrcTimestamps(raw), raw });
});

// ── /api/network — LAN URLs the user's phone can hit on the same WiFi. ────
// Classify each interface so the UI can de-emphasize VPN tunnels (singbox /
// wireguard / tailscale) and virtual hypervisor interfaces (vbox / vmware /
// host-only 192.168.56.x).
function classifyIface(name, address) {
  const n = (name || "").toLowerCase();
  if (/tun|tap|tailscale|wireguard|singbox|vpn|warp|outline/.test(n)) return "vpn";
  if (/vbox|vmware|hyper|loopback|host-only|virtualbox/.test(n))      return "virtual";
  if (address === "192.168.56.1")                                     return "virtual"; // VBox default
  if (/wlan|wifi|wi-fi|wireless|无线/.test(n))                         return "wifi";
  if (/eth|ethernet|en\d|以太网|local area/i.test(n))                 return "wired";
  return "other";
}
function lanUrls(port) {
  const out = [];
  const ifs = networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const iface of (ifs[name] || [])) {
      if (iface.family === "IPv4" && !iface.internal) {
        out.push({
          iface: name,
          url:   `http://${iface.address}:${port}`,
          kind:  classifyIface(name, iface.address),
        });
      }
    }
  }
  // wifi > wired > other > virtual > vpn (so the top choice shows first)
  const rank = { wifi: 0, wired: 1, other: 2, virtual: 3, vpn: 4 };
  out.sort((a, b) => (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5));
  return out;
}

app.get("/api/network", (_req, res) => {
  res.json({ urls: lanUrls(Number(process.env.PORT) || 8080) });
});

// ── /api/me — what the DJ "knows" about the listener right now. ───────────
// Used by the DJ-avatar modal. Pure read; no mutation.
function startOfDayMs() {
  const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
}
app.get("/api/me", async (_req, res) => {
  const plays = getPlays(500);
  const todayMs = startOfDayMs();
  const todayCount = plays.filter(p => (p.played_at || 0) >= todayMs).length;

  const counts = new Map();
  for (const p of plays) {
    for (const a of (p.artists || [])) {
      counts.set(a, (counts.get(a) || 0) + 1);
    }
  }
  const topArtists = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, n]) => ({ name, plays: n }));

  const weather = weatherConfigured() ? (await getWeather()) : null;

  res.json({
    voice_id:    process.env.ELEVENLABS_VOICE_ID || "",
    voice_model: process.env.ELEVENLABS_MODEL || "",
    city:        process.env.WEATHER_CITY || "",
    weather_now: weather,
    top_artists: topArtists,
    plays_total: plays.length,
    plays_today: todayCount,
    favorites:   getFavorites().length,
    blacklist:   getBlacklist().length,
    lan_urls:    lanUrls(Number(process.env.PORT) || 8080),
  });
});

// /api/taste/playlist — bulk-add lines into user/playlists.json[bucket].
// Body: { lines: ["Song - Artist", ...], bucket: "favorites" }.
// Lines are trimmed, deduped against the existing bucket, and appended.
const PLAYLISTS_PATH = join(__dirname, "..", "user", "playlists.json");

function loadPlaylists() {
  if (!existsSync(PLAYLISTS_PATH)) return {};
  try { return JSON.parse(readFileSync(PLAYLISTS_PATH, "utf8")) || {}; }
  catch { return {}; }
}
function savePlaylists(p) {
  writeFileSync(PLAYLISTS_PATH, JSON.stringify(p, null, 2), "utf8");
}

app.post("/api/taste/playlist", (req, res) => {
  const body = req.body || {};
  const bucket = String(body.bucket || "favorites").trim().slice(0, 60);
  if (!bucket) return res.status(400).json({ error: "bucket required" });

  let lines = body.lines;
  if (typeof body.text === "string") lines = body.text.split(/\r?\n/);
  if (!Array.isArray(lines)) return res.status(400).json({ error: "lines must be array or text string" });

  const cleaned = lines
    .map(s => String(s || "").trim())
    .filter(Boolean)
    .filter(s => !s.startsWith("#")); // ignore comment lines

  const p = loadPlaylists();
  const existing = Array.isArray(p[bucket]) ? p[bucket] : [];
  const seen = new Set(existing.map(s => s.toLowerCase()));
  const added = [];
  for (const line of cleaned) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(line);
    added.push(line);
  }
  p[bucket] = existing;
  savePlaylists(p);
  res.json({ ok: true, bucket, added: added.length, total: existing.length });
});

app.get("/api/taste/playlists", (_req, res) => {
  res.json(loadPlaylists());
});

// /api/meta — read-only config snapshot for the Settings drawer.
app.get("/api/meta", async (_req, res) => {
  const weather = weatherConfigured() ? (await getWeather()) : null;
  res.json({
    voice_id: process.env.ELEVENLABS_VOICE_ID || "",
    voice_model: process.env.ELEVENLABS_MODEL || "",
    city: process.env.WEATHER_CITY || (process.env.WEATHER_LAT && process.env.WEATHER_LON ? `${process.env.WEATHER_LAT},${process.env.WEATHER_LON}` : ""),
    weather_now: weather,
    weather_configured: weatherConfigured(),
    tts_configured: !!process.env.ELEVENLABS_API_KEY,
    claude_bin: process.env.CLAUDE_BIN || "claude",
    scheduler_off: process.env.SCHEDULER_OFF === "1",
  });
});

// ── NetEase Music login (QR scan) ────────────────────────────────────────
// 1. POST /api/ncm/login/start → { key, qrimg } — render qrimg in the UI.
// 2. GET  /api/ncm/login/check?key=… polls every ~2s:
//      801 waiting, 802 scanned, 803 authorized (cookie saved automatically).
// 3. GET  /api/ncm/login/status → who am I, am I VIP?
// 4. POST /api/ncm/logout → drop the cookie.
app.post("/api/ncm/login/start", async (_req, res) => {
  try {
    const r = await createQr();
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ncm/login/check", async (req, res) => {
  const key = String(req.query.key || "");
  if (!key) return res.status(400).json({ error: "missing key" });
  try {
    res.json(await checkQr(key));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ncm/login/status", async (_req, res) => {
  res.json(await loginStatus());
});

app.post("/api/ncm/logout", (_req, res) => {
  logout();
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT) || 8080;
const server = app.listen(PORT, () => {
  console.log(`[fishio] listening on http://localhost:${PORT}`);
  const lans = lanUrls(PORT);
  if (lans.length) {
    console.log(`[fishio] reachable on LAN — open these on your phone:`);
    for (const u of lans) {
      const tag = u.kind === "wifi" ? "← try this first" : (u.kind === "vpn" || u.kind === "virtual" ? `(${u.kind})` : "");
      console.log(`         ${u.url.padEnd(28)} ${u.iface.padEnd(20)} ${tag}`);
    }
  }
  console.log(`  POST /api/chat     { input: "..." , trigger?: "user" }`);
  console.log(`  GET  /api/now`);
  console.log(`  GET  /api/next`);
  console.log(`  POST /api/advance`);
  console.log(`  POST /api/skip`);
  console.log(`  POST /api/queue/jump  /api/queue/move  /api/queue/remove`);
  console.log(`  POST /api/favorite   /api/unfavorite`);
  console.log(`  POST /api/hide       /api/unhide`);
  console.log(`  GET  /api/library`);
  console.log(`  WS   /stream`);
  console.log(`  GET  /tts/<hash>.mp3 (cache)`);
  console.log(`  POST /api/ncm/login/start      → { key, qrimg }`);
  console.log(`  GET  /api/ncm/login/check?key= → { code, ... }`);
  console.log(`  GET  /api/ncm/login/status     → { loggedIn, nickname, vipType }`);
  console.log(`  POST /api/ncm/logout`);
  console.log(`  GET  /healthz`);
});

attachStream(server);
if (process.env.SCHEDULER_OFF !== "1") startScheduler();
startAutopilot();
