// context.js — assemble the prompt by gluing six fragments together:
//   1. dj-persona       (prompts/dj-persona.md)
//   2. user corpus      (user/*.md, user/*.json)
//   3. environment      (now / weather stub / calendar stub)
//   4. retrieved memory (last N plays from state)
//   5. recent dialogue  (last N messages)
//   6. current input    (this turn)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMessages, getPlays, getFavorites, getBlacklist } from "./state.js";
import { getSnapshot as getWeather } from "./weather.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function readPersona() {
  return readFileSync(join(ROOT, "prompts", "dj-persona.md"), "utf8");
}

function readUserCorpus() {
  const dir = join(ROOT, "user");
  if (!existsSync(dir)) return "";
  const parts = [];
  for (const name of readdirSync(dir).sort()) {
    const ext = extname(name).toLowerCase();
    if (ext !== ".md" && ext !== ".json") continue;
    const body = readFileSync(join(dir, name), "utf8").trim();
    if (!body) continue;
    parts.push(`--- ${name} ---\n${body}`);
  }
  return parts.join("\n\n");
}

async function envSnapshot() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const hour = now.getHours();
  let phase = "深夜";
  if (hour >= 5  && hour < 9)  phase = "清晨";
  else if (hour >= 9  && hour < 12) phase = "上午";
  else if (hour >= 12 && hour < 14) phase = "午间";
  else if (hour >= 14 && hour < 18) phase = "下午";
  else if (hour >= 18 && hour < 22) phase = "夜晚";
  const weather = (await getWeather()) || "(未接入)";
  // calendar stays a stub until Feishu lands.
  return [
    `当前时间:${local}(${phase})`,
    `天气:${weather}`,
    `日程:(未接入)`,
  ].join("\n");
}

function recentPlays() {
  const plays = getPlays(15);
  if (!plays.length) return "(空)";
  return plays.map(p => `- ${p.query}`).join("\n");
}

function favoritesList() {
  const favs = getFavorites();
  if (!favs.length) return "(空)";
  // Cap to last 30 so the prompt doesn't balloon.
  return favs.slice(-30).map(f => `- ${f.query}`).join("\n");
}

function blacklistList() {
  const bl = getBlacklist();
  if (!bl.length) return "(空)";
  return bl.slice(-30).map(b => `- ${b.query}`).join("\n");
}

function recentDialogue() {
  const msgs = getMessages(10);
  if (!msgs.length) return "(空)";
  return msgs.map(m => `${m.role === "user" ? "主人" : "Fishio"}: ${m.text}`).join("\n");
}

/**
 * Build the full prompt string to feed to `claude -p` stdin.
 * trigger:  "user" | "schedule" | "system"
 * input:    the user's message OR a scheduler-emitted line (e.g. "早晨 9 点了")
 */
export async function buildPrompt({ trigger = "user", input }) {
  const persona = readPersona();
  const corpus  = readUserCorpus();
  const env     = await envSnapshot();
  const plays   = recentPlays();
  const dialog  = recentDialogue();
  const favs    = favoritesList();
  const bl      = blacklistList();

  return [
    "# System prompt",
    persona,
    "",
    "# Listener corpus",
    corpus || "(empty)",
    "",
    "# Environment",
    env,
    "",
    "# Recently played (avoid repeating)",
    plays,
    "",
    "# Listener favorites (lean toward similar texture)",
    favs,
    "",
    "# Listener blacklist — never pick these or near-clones",
    bl,
    "",
    "# Recent dialogue",
    dialog,
    "",
    `# This turn (trigger=${trigger})`,
    input,
    "",
    "# Now output strictly one JSON object per the dj-persona contract. No markdown fences, no commentary.",
  ].join("\n");
}
