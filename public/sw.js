// sw.js — minimum service worker so phones (Chrome / Edge / Safari) treat
// Fishio as an installable PWA. We do NOT cache anything; the page is always
// fetched live so changes you make to the server show up on next reload.
self.addEventListener("install",  (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",    (e) => { /* pass-through, no caching */ });
