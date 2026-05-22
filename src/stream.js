// stream.js — WebSocket /stream hub. Pushes state changes to all connected
// clients. Replaces polling on the client.
import { WebSocketServer } from "ws";
import { bus } from "./events.js";
import { getQueue, currentWithFreshUrl } from "./state.js";

export function attachStream(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/stream" });

  wss.on("connection", async (ws) => {
    // on connect: send a snapshot so the client can render immediately.
    // Refresh URL in case state was reloaded with a stale stream URL on disk.
    const current = await currentWithFreshUrl();
    safeSend(ws, { type: "snapshot", current, queue: getQueue() });
  });

  const broadcast = (msg) => {
    const json = JSON.stringify(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === 1 /* OPEN */) ws.send(json);
    }
  };

  bus.on("enqueue",  ({ tracks, current }) => broadcast({ type: "enqueue",  tracks, current, queue: getQueue() }));
  bus.on("advance",  ({ current })         => broadcast({ type: "advance",  current, queue: getQueue() }));
  bus.on("say",      ({ text })            => broadcast({ type: "say",      text, ts: Date.now() }));
  bus.on("tts",      ({ url, text })       => broadcast({ type: "tts",      url, text }));
  bus.on("library",         (lib) => broadcast({ type: "library", ...lib }));
  bus.on("history-cleared", ()    => broadcast({ type: "history-cleared" }));

  return wss;
}

function safeSend(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
}
