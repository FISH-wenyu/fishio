// weather.js — OpenWeatherMap "current weather" call, 10-min memory cache.
// Feeds context.js's env section. If unconfigured or the API errors out, we
// return null and context falls back to "(未接入)". Caller stays sync-ish
// because getSnapshot returns a memoized string after first warmup.
const KEY  = process.env.OPENWEATHER_KEY || "";
const CITY = process.env.WEATHER_CITY    || "";
const LAT  = process.env.WEATHER_LAT     || "";
const LON  = process.env.WEATHER_LON     || "";
const TTL_MS = 10 * 60 * 1000;

let cache = { ts: 0, value: null };
let inflight = null;

export function weatherConfigured() {
  return !!KEY && (!!CITY || (!!LAT && !!LON));
}

async function fetchNow() {
  const params = new URLSearchParams({
    appid: KEY,
    units: "metric",
    lang: "en",
  });
  if (LAT && LON) {
    params.set("lat", LAT);
    params.set("lon", LON);
  } else {
    params.set("q", CITY);
  }

  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openweather ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  const temp     = Math.round(Number(j?.main?.temp));
  const feels    = Math.round(Number(j?.main?.feels_like));
  const humidity = Number(j?.main?.humidity);
  const desc     = j?.weather?.[0]?.description || "";
  const name     = j?.name || CITY || "(unknown)";
  const parts = [`${name} ${temp}°C ${desc}`];
  if (Number.isFinite(feels) && Math.abs(feels - temp) >= 2) parts.push(`feels like ${feels}°C`);
  if (Number.isFinite(humidity)) parts.push(`humidity ${humidity}%`);
  return parts.join(" · ");
}

/** Returns a short Chinese summary, or null if no key / city / network fails. */
export async function getSnapshot() {
  if (!weatherConfigured()) return null;
  if (cache.value && Date.now() - cache.ts < TTL_MS) return cache.value;
  // Coalesce concurrent calls — first turn after restart sees the same fetch.
  if (!inflight) {
    inflight = fetchNow()
      .then((v) => { cache = { ts: Date.now(), value: v }; return v; })
      .catch((e) => { console.error("[weather]", e.message); return null; })
      .finally(() => { inflight = null; });
  }
  return await inflight;
}
