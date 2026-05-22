// Tiny smoke test for ncm.js. Run: node src/ncm.smoke.js
// Confirms search → url path works against the live NetEase API.
import { resolveTrack } from "./ncm.js";

const q = process.argv[2] || "City Pop 山下达郎";
console.log(`[smoke] resolving: ${q}`);
const t = await resolveTrack(q);
if (!t)            console.log("[smoke] no match");
else if (!t.url)   console.log(`[smoke] matched ${t.name} - ${t.artists.join(", ")} but no playable URL (copyright)`);
else               console.log(`[smoke] ${t.name} - ${t.artists.join(", ")}\n[smoke] url: ${t.url}`);
