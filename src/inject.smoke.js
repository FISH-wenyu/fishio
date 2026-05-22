// Bypasses claude. Pretends the brain returned 2 plays, runs them through
// ncm + state, persists. Then a server restart will pick them up so we can
// hit /api/now and confirm the downstream half of the pipeline works.
import { resolveQueries } from "./ncm.js";
import { enqueueAll, getCurrent, getQueue } from "./state.js";

const queries = process.argv.slice(2);
if (queries.length === 0) {
  queries.push("陈奕迅 浮夸", "周杰伦 七里香");
}

console.log("[inject] resolving:", queries);
const resolved = await resolveQueries(queries);
for (const r of resolved) {
  console.log(`  ${r.error ? "X" : "✓"} ${r.query} → ${r.name || "?"} ${r.url ? "(url ok)" : "(no url)"}`);
}
const playable = resolved.filter(r => r.url);
enqueueAll(playable);
console.log("[inject] current =", getCurrent()?.name);
console.log("[inject] queue   =", getQueue().map(t => t.name));
