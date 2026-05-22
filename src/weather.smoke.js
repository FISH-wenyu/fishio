// Smoke test for weather.js. Run: node --env-file=.env src/weather.smoke.js
import { getSnapshot, weatherConfigured } from "./weather.js";

if (!weatherConfigured()) {
  console.error("[smoke] OPENWEATHER_KEY or WEATHER_CITY/LAT-LON not set in .env");
  process.exit(1);
}

console.log("[smoke] calling OpenWeather…");
const t0 = Date.now();
const s = await getSnapshot();
console.log(`[smoke] ${Date.now() - t0}ms → ${s ?? "(null — check logs above)"}`);
