// events.js — single in-process event bus so the WS hub, scheduler, and
// anything else can react to state changes without circular imports.
//   "say"      { text }           — DJ said a line
//   "enqueue"  { tracks, current } — new tracks added (current may have flipped if it was null)
//   "advance"  { current }         — current song advanced
import { EventEmitter } from "node:events";
export const bus = new EventEmitter();
bus.setMaxListeners(50);
