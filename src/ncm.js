// ncm.js — thin wrapper over NeteaseCloudMusicApi.
// Uses the lib in-process (no separate server). Three concerns: search a
// human-readable query to song id, resolve id to a playable URL (which may be
// null for songs we can't stream), and fetch lyrics for the player display.
// VIP / paid-catalog tracks return url=null unless we attach a logged-in
// cookie — see loginQr*() below and getCookie() which reads from state.prefs.
import ncm from "NeteaseCloudMusicApi";
import { getPrefs, setPref } from "./state.js";

const { search, song_url_v1, lyric, login_qr_key, login_qr_create, login_qr_check, login_status } = ncm;

function getCookie() {
  return getPrefs().ncm_cookie || "";
}

function withCookie(args = {}) {
  const cookie = getCookie();
  return cookie ? { ...args, cookie } : args;
}

// NCM throws plain objects like { status, body: { code, msg } } — not Error
// instances. Turn them into something readable.
function describeNcmError(e) {
  if (!e) return "(no error)";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  if (e.body && (e.body.msg || e.body.message)) {
    return `ncm ${e.status || e.body.code || ""} ${e.body.msg || e.body.message}`.trim();
  }
  try { return JSON.stringify(e).slice(0, 200); } catch { return String(e); }
}

// Retry transient failures (502, TLS handshake, socket errors) with exponential
// backoff. Real "not found" responses (200 with empty results) don't throw, so
// they aren't retried.
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const transient = e?.status >= 500 || /socket|TLS|ECONN|ETIME|EAI_AGAIN|disconnect/i.test(describeNcmError(e));
      if (!transient || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// Some songs return null url (no copyright / VIP-locked). We treat those as
// unplayable and let the caller skip rather than throw.
// Parse "Song - Artist" / "Song（原唱：Artist）" / "Song by Artist" into the
// song-title half and the artist-hint half. Both are best-effort.
function splitQuery(query) {
  if (!query) return { name: "", artist: null };
  // "Song（原唱：Artist）" — artist in parenthetical
  const orig = query.match(/^(.*?)\s*[（(]\s*原唱[:：]\s*([^)）]+)\s*[)）]\s*$/);
  if (orig) return { name: orig[1].trim(), artist: orig[2].trim() };
  // "Song - Artist" / "Song — Artist" — split on the LAST dash
  const m = query.match(/^(.+?)\s[-—–]\s(.+)$/);
  if (m) return { name: m[1].trim(), artist: m[2].trim() };
  // "Song by Artist"
  const by = query.match(/^(.+?)\sby\s+(.+)$/i);
  if (by) return { name: by[1].trim(), artist: by[2].trim() };
  return { name: query.trim(), artist: null };
}

const norm = (s) => String(s || "")
  .toLowerCase()
  .replace(/[（(].*?[)）]/g, "")          // drop bracketed annotations
  .replace(/[\s\-—–·,，.。!?\"'“”‘’]+/g, "")
  .trim();

// 0 / 1 partial / 2 exact (or near-exact after normalization).
function nameMatchScore(songName, queryName) {
  if (!queryName) return 0;
  const a = norm(songName);
  const b = norm(queryName);
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  return 0;
}

function artistMatchScore(songArtists, hint) {
  if (!hint) return 0;
  const h = norm(hint);
  if (!h) return 0;
  let best = 0;
  for (const a of songArtists) {
    const n = norm(a.name);
    if (!n) continue;
    if (n === h) return 2;
    if (n.includes(h) || h.includes(n)) best = Math.max(best, 1);
  }
  return best;
}

// Cover / remake / instrumental / karaoke / DJ-remix markers that we strongly
// don't want when the query looks like a single original-track name.
const COVER_RX = /(翻唱|cover|cover\s*by|致敬|致歉|piano\s*ver|演奏版|演唱|纯音乐|伴奏|karaoke|卡拉|kara|instrumental|inst\.|inst$|remix|dj\s*版|dj\s*remix|柔情版|轻音乐|无损版|bgm|mashup|dance\s*ver|动态版|超长版|完整版|live\s*版|抖音版|短视频版|高潮版|sped\s*up|slow(ed)?\s*(\+)?\s*reverb|cover\s*version)/i;
const ORIG_CHN = /原唱[:：]/;

function coverPenalty(songName, songArtists, queryArtist) {
  let p = 0;
  if (COVER_RX.test(songName))   p += 2;     // suspicious suffix in title
  if (ORIG_CHN.test(songName))   p += 3;     // 原唱:XXX in title == always a cover
  // Some covers omit any tag but the artist clearly isn't the queried one. We
  // already capture that via artistMatchScore — this only adds extra weight if
  // a cover-tagged title slips in.
  return p;
}

async function searchOne(query) {
  // Bump limit from 10 → 20 so deeper matches survive when NCM ranks covers
  // higher (which is depressingly common for popular tracks).
  const r = await withRetry(() => search(withCookie({ keywords: query, limit: 20 })));
  const songs = r?.body?.result?.songs;
  if (!Array.isArray(songs) || songs.length === 0) return null;

  const { name: qName, artist: qArtist } = splitQuery(query);

  // Composite score = artist match * 3 + name match * 2 − cover penalty.
  // Tie-break on original NCM rank.
  const ranked = songs
    .map((s, i) => {
      const am = artistMatchScore(s.artists || [], qArtist);
      const nm = nameMatchScore(s.name, qName);
      const cp = coverPenalty(s.name, s.artists || [], qArtist);
      return { s, idx: i, score: am * 3 + nm * 2 - cp };
    })
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  const pick = ranked[0].s;

  return {
    id:      pick.id,
    name:    pick.name,
    artists: (pick.artists || []).map(a => a.name),
    album:   pick.album?.name || "",
    picUrl:  pick.album?.picUrl || pick.al?.picUrl || "",
  };
}

async function getUrl(id) {
  // level: standard is fine for non-VIP. With a VIP-account cookie attached,
  // the API will return a URL for premium tracks too.
  const r = await withRetry(() => song_url_v1(withCookie({ id, level: "standard" })));
  const url = r?.body?.data?.[0]?.url;
  return url || null;
}

async function getLyric(id) {
  try {
    const r = await lyric(withCookie({ id }));
    return r?.body?.lrc?.lyric || "";
  } catch {
    return "";
  }
}

/**
 * Resolve a free-text query to a playable track, or null if nothing works.
 * Returns { id, name, artists, album, url, lyric } — url may be null if NCM
 * doesn't serve a stream for this region/copyright.
 */
export async function resolveTrack(query) {
  const meta = await searchOne(query);
  if (!meta) return null;
  const url = await getUrl(meta.id);
  return { ...meta, url };
}

export async function resolveLyric(id) {
  return await getLyric(id);
}

/** Get a fresh playable URL for a known song id (NCM URLs expire ~30 min). */
export async function refreshUrl(id) {
  if (!id) return null;
  try {
    return await getUrl(id);
  } catch (e) {
    console.error("[ncm] refreshUrl failed:", e.message);
    return null;
  }
}

// ── Login (QR scan with the user's NetEase Music phone app) ──────────────
// Three-step flow exposed so server.js can wire HTTP endpoints:
//   1. createQr()  → { key, qrimg }       — show qrimg to user
//   2. checkQr(key) every ~2s             — codes: 800 expired / 801 waiting /
//                                            802 scanned / 803 authorized
//   3. on code 803 the cookie is saved to state.prefs.ncm_cookie and we are
//      done. Subsequent NCM calls automatically attach it (see withCookie).

export async function createQr() {
  const keyRes = await login_qr_key();
  const key = keyRes?.body?.data?.unikey || keyRes?.body?.unikey;
  if (!key) throw new Error("login_qr_key returned no unikey");
  const imgRes = await login_qr_create({ key, qrimg: true });
  const qrimg = imgRes?.body?.data?.qrimg || imgRes?.body?.qrimg;
  return { key, qrimg };
}

export async function checkQr(key) {
  const r = await login_qr_check({ key });
  // The library sometimes hides the cookie at the top of .body, sometimes
  // alongside the code; we look in both spots.
  const code   = r?.body?.code;
  const cookie = r?.body?.cookie || r?.cookie || "";
  if (code === 803 && cookie) {
    setPref("ncm_cookie", cookie);
  }
  return { code, message: r?.body?.message || "", saved: code === 803 };
}

export async function loginStatus() {
  const cookie = getCookie();
  if (!cookie) return { loggedIn: false };
  try {
    const r = await login_status({ cookie });
    const profile = r?.body?.data?.profile || r?.body?.profile;
    if (!profile) return { loggedIn: false };
    return {
      loggedIn:  true,
      nickname:  profile.nickname,
      userId:    profile.userId,
      vipType:   profile.vipType || 0, // 0=free, 10=月度, 11=年度, 等
      avatarUrl: profile.avatarUrl,
    };
  } catch (e) {
    console.error("[ncm] loginStatus failed:", e.message);
    return { loggedIn: false };
  }
}

export function logout() {
  setPref("ncm_cookie", "");
}

// Resolve a list of queries in parallel. Items that don't resolve come back
// as { query, error } so the caller can keep going.
export async function resolveQueries(queries) {
  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const t = await resolveTrack(q);
        if (!t) return { query: q, error: "no match" };
        if (!t.url) return { query: q, ...t, error: "no stream url (copyright?)" };
        return { query: q, ...t };
      } catch (e) {
        return { query: q, error: describeNcmError(e) };
      }
    })
  );
  return results;
}
