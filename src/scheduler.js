// scheduler.js — node-cron triggers that fire route({trigger:"schedule"}).
// Edit `SCHEDULES` to change cadence. All times use the host's local zone.
import cron from "node-cron";
import { route } from "./router.js";

const SCHEDULES = [
  {
    name: "morning-plan",
    cron: "0 7 * * *",
    input: "It's 7am. Open the morning radio with a short line and pick 2 songs that ease the listener into being awake.",
  },
  {
    name: "morning-broadcast",
    cron: "0 9 * * *",
    input: "It's 9am, work hours starting. Pick 2 tracks that fit writing code — instrumental or light vocals — and a brief intro.",
  },
  {
    name: "hourly-mood-check",
    // every hour at :00, but skip the slots we already cover above
    cron: "0 10-23 * * *",
    input: "Top of the hour. Look at the time of day and the recent plays; if the mood needs a turn, pick 1-2 tracks. If not, just say one short line without queuing anything.",
  },
];

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;
  for (const s of SCHEDULES) {
    cron.schedule(s.cron, async () => {
      console.log(`[scheduler] firing ${s.name}`);
      try {
        await route({ trigger: "schedule", input: s.input });
      } catch (e) {
        console.error(`[scheduler] ${s.name} failed:`, e.message);
      }
    });
    console.log(`[scheduler] registered ${s.name} (${s.cron})`);
  }
}
