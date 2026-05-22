// claude.js — adapter around `claude -p --output-format json`.
// Spawns a subprocess, feeds the prompt on stdin, parses the JSON wrapper
// the CLI emits, and extracts the model's structured DJ payload from
// `.result`. We re-parse `.result` as JSON (the persona prompt forces JSON).
import { spawn } from "node:child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60_000;

class ClaudeError extends Error {
  constructor(message, { stderr, raw } = {}) {
    super(message);
    this.name = "ClaudeError";
    this.stderr = stderr;
    this.raw = raw;
  }
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    // On Windows, spawning a .cmd shim requires shell:true so the .cmd is
    // found and PATHEXT is honored. Quote args ourselves to survive cmd parsing.
    const isWin = process.platform === "win32";
    const child = spawn(CLAUDE_BIN, args, {
      shell: isWin,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new ClaudeError(`claude timed out after ${TIMEOUT_MS}ms`, { stderr }));
    }, TIMEOUT_MS);

    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ClaudeError(`spawn failed: ${err.message}`, { stderr }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        return reject(new ClaudeError(`claude exited ${code}`, { stderr, raw: stdout }));
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(prompt, "utf8");
  });
}

// Strip ```json ... ``` fences and leading/trailing whitespace so we can
// JSON.parse what the model returned even if it wrapped it.
function unfence(s) {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

/**
 * Run the brain. Returns { say, play, reason, segue }.
 * Throws ClaudeError on transport / parse failure — caller decides fallback.
 */
export async function ask(prompt) {
  const { stdout, stderr } = await runClaude(prompt);

  let wrapper;
  try {
    wrapper = JSON.parse(stdout);
  } catch (e) {
    throw new ClaudeError(`could not parse CLI JSON wrapper: ${e.message}`, {
      stderr, raw: stdout,
    });
  }

  if (wrapper.is_error) {
    throw new ClaudeError(`claude reported error: ${wrapper.result || "(no message)"}`, {
      stderr, raw: stdout,
    });
  }

  const inner = unfence(String(wrapper.result ?? ""));
  let payload;
  try {
    payload = JSON.parse(inner);
  } catch (e) {
    throw new ClaudeError(`model output was not JSON: ${e.message}`, {
      stderr, raw: inner,
    });
  }

  return normalize(payload);
}

function normalize(p) {
  return {
    say:    typeof p.say === "string" ? p.say : "",
    play:   Array.isArray(p.play)
              ? p.play.filter(x => x && typeof x.query === "string")
                       .map(x => ({ query: x.query, reason: x.reason || "" }))
              : [],
    reason: typeof p.reason === "string" ? p.reason : "",
    segue:  typeof p.segue === "string" ? p.segue : "",
  };
}

export { ClaudeError };
