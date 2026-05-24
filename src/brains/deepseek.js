// brains/deepseek.js — DeepSeek HTTP adapter (OpenAI-compatible).
// Endpoint:  https://api.deepseek.com/chat/completions
// Models:    deepseek-chat (V3, fast & cheap; default)
//            deepseek-reasoner (R1, slower & smarter; opt-in)
//
// The whole Fishio prompt is sent as one "user" message — context.js already
// labels its own `# System prompt` section internally, and DeepSeek follows
// it just fine. We turn on JSON Mode so the model can't slip out of the
// strict {say,play,reason,segue} contract.
import { BrainError, normalize, unfence } from "./common.js";

const ENDPOINT   = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
const KEY        = process.env.DEEPSEEK_API_KEY  || "";
const MODEL      = process.env.DEEPSEEK_MODEL    || "deepseek-chat";
const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 60_000;
const TEMP       = Number.isFinite(Number(process.env.DEEPSEEK_TEMPERATURE))
                     ? Number(process.env.DEEPSEEK_TEMPERATURE)
                     : 1.0;   // DeepSeek docs: ~1.0 is balanced for chat

/**
 * Ask DeepSeek. Returns { say, play, reason, segue }.
 * Throws BrainError on transport / parse failure.
 */
export async function ask(prompt) {
  if (!KEY) {
    throw new BrainError("DEEPSEEK_API_KEY not set", { provider: "deepseek" });
  }

  // R1 (reasoner) doesn't support JSON Mode at the time of writing — gate it
  // so we don't get a 400 from the server. V3 (chat) supports it fine.
  const wantJsonMode = !/reasoner|r1/i.test(MODEL);
  const body = {
    model: MODEL,
    temperature: TEMP,
    messages: [{ role: "user", content: prompt }],
    ...(wantJsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw new BrainError(`deepseek timed out after ${TIMEOUT_MS}ms`, { provider: "deepseek" });
    }
    throw new BrainError(`deepseek network error: ${e.message}`, { provider: "deepseek" });
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    throw new BrainError(`deepseek ${res.status}`, {
      provider: "deepseek", status: res.status, body: text.slice(0, 400),
    });
  }

  let wrapper;
  try { wrapper = JSON.parse(text); }
  catch (e) {
    throw new BrainError(`could not parse deepseek envelope: ${e.message}`, {
      provider: "deepseek", raw: text,
    });
  }

  const content = wrapper?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new BrainError("deepseek returned no content", {
      provider: "deepseek", raw: JSON.stringify(wrapper).slice(0, 400),
    });
  }

  // R1's reasoning_content (chain-of-thought) lives in a separate field; the
  // final answer is in `content`. We only care about the final answer here.
  let payload;
  try {
    payload = JSON.parse(unfence(content));
  } catch (e) {
    throw new BrainError(`model output was not JSON: ${e.message}`, {
      provider: "deepseek", raw: content.slice(0, 400),
    });
  }

  return normalize(payload);
}
