// brains/claude.js — Claude Code CLI adapter.
// Spawns `claude -p --output-format json`, pipes the prompt to stdin,
// parses the CLI's JSON wrapper, then JSON-parses the model's `.result`
// (the persona forces strict JSON). Throws BrainError on transport /
// parse failure so the dispatcher can fall back to another provider.
import { spawn } from "node:child_process";
import { BrainError, normalize, unfence } from "./common.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60_000;

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    // Windows .cmd / .bat shims can't be spawned directly. Explicitly
    // invoke cmd.exe to avoid DEP0190 (the shell:true deprecation) and
    // its implicit shell-injection risk.
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", CLAUDE_BIN, ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          windowsVerbatimArguments: false,
        })
      : spawn(CLAUDE_BIN, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new BrainError(`claude timed out after ${TIMEOUT_MS}ms`, { provider: "claude", stderr }));
    }, TIMEOUT_MS);

    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BrainError(`spawn failed: ${err.message}`, { provider: "claude", stderr }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        return reject(new BrainError(`claude exited ${code}`, { provider: "claude", stderr, raw: stdout }));
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(prompt, "utf8");
  });
}

/**
 * Ask Claude. Returns { say, play, reason, segue }.
 * Throws BrainError on transport / parse failure.
 */
export async function ask(prompt) {
  const { stdout, stderr } = await runClaude(prompt);

  let wrapper;
  try {
    wrapper = JSON.parse(stdout);
  } catch (e) {
    throw new BrainError(`could not parse CLI JSON wrapper: ${e.message}`, {
      provider: "claude", stderr, raw: stdout,
    });
  }

  if (wrapper.is_error) {
    throw new BrainError(`claude reported error: ${wrapper.result || "(no message)"}`, {
      provider: "claude", stderr, raw: stdout,
    });
  }

  const inner = unfence(String(wrapper.result ?? ""));
  let payload;
  try {
    payload = JSON.parse(inner);
  } catch (e) {
    throw new BrainError(`model output was not JSON: ${e.message}`, {
      provider: "claude", stderr, raw: inner,
    });
  }

  return normalize(payload);
}
