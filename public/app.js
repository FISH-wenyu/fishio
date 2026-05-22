// Fishio PWA — single-page radio client.
// Talks to the local server over HTTP + WebSocket. Three concerns:
//   1. Render: clock / player / queue / DJ log
//   2. Drive playback: <audio> for music, separate <audio> for TTS voice-overs
//   3. Settings drawer: theme, NCM QR login, favorites / blacklist viewer

const $  = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ── element refs ──────────────────────────────────────────────────────────
const audio        = $("audio");
const ttsAudio     = $("tts-audio");
const elTrack      = $("track");
const elStatus     = $("status");
const elClock      = $("clock");
const elWeekday    = $("weekday");
const elDate       = $("date");
const elQueue      = $("queue");
const elQCount     = $("q-count");
const elLog        = $("log-feed");
const elWsState    = $("ws-state");
const elFooter     = $("footer-state");
const elTCur       = $("t-cur");
const elTDur       = $("t-dur");
const elBarFill    = $("bar-fill");
const elBar        = document.querySelector(".bar");
const playerPanel  = document.querySelector(".player");

const form         = $("chat-form");
const input        = $("chat-input");
const btnSend      = $("btn-send");

const btnPrev      = $("btn-prev");
const btnPlay      = $("btn-play");
const btnNext      = $("btn-next");
const btnStop      = $("btn-stop");
const btnFav       = $("btn-fav");
const btnHide      = $("btn-hide");
const btnBan       = $("btn-ban");
const btnLyric     = $("btn-lyric");
const vol          = $("vol");
const playerPanelEl= $("player-panel");
const playerChip   = $("player-chip");
const chipTrack    = $("chip-track");
const coverArt     = $("cover-art");
const lyricModal   = $("lyric-modal");
const lyricBody    = $("lyric-body");
const lyricName    = $("lyric-track-name");

const btnMic       = $("btn-mic");
const btnSettings  = $("btn-settings");
const btnCloseSet  = $("btn-close-settings");
const drawer       = $("drawer");
const drawerScrim  = $("drawer-scrim");
const themeButtons = $$(".theme-switch button");

const ncmStatusEl  = $("ncm-status");
const ncmQrEl      = $("ncm-qr");
const ncmQrImg     = $("ncm-qrimg");
const ncmQrMsg     = $("ncm-qr-msg");
const btnNcmLogin  = $("btn-ncm-login");
const btnNcmLogout = $("btn-ncm-logout");

const voiceIdEl    = $("voice-id");
const cityEl       = $("weather-city");
const weatherStat  = $("weather-status");
const favCount     = $("fav-count");
const favList      = $("fav-list");
const blCount      = $("bl-count");
const blList       = $("bl-list");

// ── state ─────────────────────────────────────────────────────────────────
let current        = null;
let queue          = [];
let lastUrl        = null;       // skip resetting <audio>.src when unchanged
let ttsPlaying     = false;
let musicWasPlaying = false;
let library        = { favorites: [], blacklist: [] };
let qrPollTimer    = null;
let qrKey          = null;

// ── helpers ───────────────────────────────────────────────────────────────
function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtDur(s) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2,"0")}`;
}
function setStatus(text) { elStatus.textContent = text.toUpperCase(); }
function setFooter(text) { elFooter.textContent = text.toUpperCase(); }
function setWsState(text) { elWsState.textContent = text.toUpperCase(); }

function trackKey(t) {
  if (!t) return "";
  return t.id != null ? `id:${t.id}` : `q:${t.query || t.name || ""}`;
}
function inList(list, t) { const k = trackKey(t); return list.some(x => trackKey(x) === k); }

// ── theme ────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButtons.forEach(b => b.classList.toggle("active", b.dataset.themeSet === theme));
  localStorage.setItem("fishio.theme", theme);
}
themeButtons.forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.themeSet)));
applyTheme(localStorage.getItem("fishio.theme") || "dark");

// ── clock ────────────────────────────────────────────────────────────────
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS   = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function tickClock() {
  const d = new Date();
  elClock.textContent   = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  elWeekday.textContent = WEEKDAYS[d.getDay()];
  elDate.textContent    = `${String(d.getDate()).padStart(2,"0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
tickClock();
setInterval(tickClock, 1000);

// ── render: track + queue ─────────────────────────────────────────────────
function renderNow(t) {
  current = t;
  if (!t) {
    // Don't show an ugly "nothing yet" placeholder — autopilot will refill
    // shortly. Use a neutral hint.
    elTrack.textContent = "queueing up…";
    chipTrack.textContent = "show player";
    setStatus("waiting");
    audio.removeAttribute("src");
    lastUrl = null;
    setCoverArt(null);
    refreshFavButton();
    return;
  }
  const title = t.name || t.query || "(unknown)";
  const who   = (t.artists || []).join(" / ");
  elTrack.textContent = who ? `${title} — ${who}` : title;
  chipTrack.textContent = `${title}${who ? " · " + who : ""}`;
  setCoverArt(t.picUrl || null);
  setStatus("playing");
  if (t.url && t.url !== lastUrl) {
    audio.src = t.url;
    lastUrl = t.url;
    if (!ttsPlaying) {
      audio.play().catch(() => setStatus("tap play"));
    }
  }
  refreshFavButton();
  updateMediaSession(t);
}

function setCoverArt(url) {
  // Preserve the visualizer bars; just toggle the cover image.
  const existing = coverArt.querySelector("img");
  if (url) {
    if (existing) existing.src = url;
    else {
      const img = document.createElement("img");
      img.src = url; img.alt = "";
      coverArt.insertBefore(img, coverArt.firstChild);
    }
  } else if (existing) {
    existing.remove();
  }
}

// Lock-screen / OS-level media controls on Chrome / Safari / Edge.
function updateMediaSession(t) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  t.name || t.query || "Fishio",
    artist: (t.artists || []).join(", "),
    album:  t.album || "Fishio",
    artwork: t.picUrl ? [{ src: t.picUrl, sizes: "300x300", type: "image/jpeg" }] : [],
  });
  navigator.mediaSession.setActionHandler("play",         () => audio.play().catch(() => {}));
  navigator.mediaSession.setActionHandler("pause",        () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack",    () => btnNext.click());
  navigator.mediaSession.setActionHandler("previoustrack",() => btnPrev.click());
}

function renderQueue(list) {
  queue = list || [];
  elQueue.innerHTML = "";
  elQCount.textContent = queue.length;
  if (queue.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "— empty —";
    elQueue.appendChild(li);
    return;
  }
  queue.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = "q-row";
    li.draggable = true;
    li.dataset.idx = i;

    const handle = document.createElement("span");
    handle.className = "q-handle";
    handle.textContent = "⋮⋮";
    handle.title = "Drag to reorder";
    li.appendChild(handle);

    const title = t.name || t.query || "?";
    const who   = (t.artists || []).join(" / ");
    const main = document.createElement("span");
    main.className = "q-title";
    main.textContent = who ? `${title} — ${who}` : title;
    main.title = "Click to play this song now";
    main.addEventListener("click", () => jumpToIndex(i));
    li.appendChild(main);

    if (t.reason) {
      const w = document.createElement("span");
      w.className = "why";
      w.textContent = "· " + t.reason;
      li.appendChild(w);
    }

    const actions = document.createElement("span");
    actions.className = "q-actions";
    actions.innerHTML = `
      <button class="q-btn" data-act="up"   title="Move up">▲</button>
      <button class="q-btn" data-act="down" title="Move down">▼</button>
      <button class="q-btn" data-act="del"  title="Remove">×</button>
    `;
    actions.querySelector('[data-act="up"]').addEventListener("click",   () => moveIndex(i, i - 1));
    actions.querySelector('[data-act="down"]').addEventListener("click", () => moveIndex(i, i + 1));
    actions.querySelector('[data-act="del"]').addEventListener("click",  () => removeIndex(i));
    if (i === 0) actions.querySelector('[data-act="up"]').disabled = true;
    if (i === queue.length - 1) actions.querySelector('[data-act="down"]').disabled = true;
    li.appendChild(actions);

    // ── drag and drop ────────────────────────────────────────────────────
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
      li.classList.add("dragging");
    });
    li.addEventListener("dragend",   () => li.classList.remove("dragging"));
    li.addEventListener("dragover",  (e) => { e.preventDefault(); li.classList.add("drag-over"); });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      const from = Number(e.dataTransfer.getData("text/plain"));
      const to   = i;
      if (Number.isInteger(from) && from !== to) moveIndex(from, to);
    });

    elQueue.appendChild(li);
  });
}

async function jumpToIndex(index) {
  // WS will broadcast the new current; this returns it too for snappiness.
  const r = await fetch("/api/queue/jump", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ index }),
  }).then(r => r.json());
  if (r.current) renderNow(r.current);
}

async function moveIndex(from, to) {
  if (to < 0 || to >= queue.length) return;
  await fetch("/api/queue/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  // WS pushes the updated queue; no local mutation needed.
}

async function removeIndex(index) {
  await fetch("/api/queue/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ index }),
  });
}

function refreshFavButton() {
  btnFav.classList.toggle("active", inList(library.favorites, current));
}

// ── render: DJ log ────────────────────────────────────────────────────────
let lastTtsByText = new Map(); // text → tts url, for replay
function appendSayMsg(text, ts = Date.now(), ttsUrl = null) {
  if (!text) return;
  // remove the "connecting..." placeholder if present
  document.querySelector(".log-feed .log-meta")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "msg";
  wrap.innerHTML = `
    <div class="avatar">F</div>
    <div class="body">
      <div class="who">FISHIO</div>
      <div class="bubble"></div>
      <div class="row">
        <button class="replay" type="button">▶ REPLAY</button>
        <span>${fmtTime(ts)}</span>
      </div>
    </div>`;
  wrap.querySelector(".bubble").textContent = text;
  const replayBtn = wrap.querySelector(".replay");
  const url = ttsUrl || lastTtsByText.get(text);
  if (!url) { replayBtn.disabled = true; replayBtn.style.opacity = "0.4"; }
  replayBtn.addEventListener("click", () => { if (url) playTts(url); });

  elLog.appendChild(wrap);
  elLog.scrollTop = elLog.scrollHeight;
}

function appendNowPlayingLine(t) {
  if (!t) return;
  const meta = document.createElement("div");
  meta.className = "log-meta song";
  meta.textContent = `Now playing — ${t.name || t.query} ${t.artists?.length ? "· " + t.artists.join(" / ") : ""}`;
  elLog.appendChild(meta);
  elLog.scrollTop = elLog.scrollHeight;
}

// ── Audio ducking helpers ─────────────────────────────────────────────────
// When the DJ speaks, we fade the music DOWN to DUCK_RATIO of its current
// volume so the voice is clearly audible without the music stopping.
// After TTS ends, we fade the music back up to the user's chosen level.
const DUCK_RATIO  = 0.15;   // music drops to 15% while DJ speaks
const FADE_MS     = 500;    // 0.5s fade in / out feels natural
let duckTimer = null;

function fadeAudio(targetVolume, durationMs = FADE_MS) {
  clearInterval(duckTimer);
  const startVol = audio.volume;
  const steps    = Math.max(1, Math.round(durationMs / 20)); // ~20ms per step
  const delta    = (targetVolume - startVol) / steps;
  let i = 0;
  duckTimer = setInterval(() => {
    i++;
    audio.volume = Math.min(1, Math.max(0, startVol + delta * i));
    if (i >= steps) {
      clearInterval(duckTimer);
      audio.volume = targetVolume;
    }
  }, durationMs / steps);
}

// ── TTS playback — duck music, overlay voice, restore ─────────────────────
function playTts(url) {
  if (!url) return;
  ttsPlaying     = true;
  musicWasPlaying = !audio.paused && !!audio.src;
  // Fade music DOWN — it keeps playing so there's no dead silence.
  fadeAudio(baseVolume * DUCK_RATIO);
  ttsAudio.src = url;
  ttsAudio.volume = 1.0;
  ttsAudio.play().catch((e) => {
    console.warn("tts autoplay blocked:", e);
    ttsPlaying = false;
    fadeAudio(baseVolume);  // restore immediately if TTS can't start
  });
}
ttsAudio.addEventListener("ended", () => {
  ttsPlaying = false;
  // Fade music back UP — 600ms so it feels like a breath, not a snap.
  fadeAudio(baseVolume, 600);
});

// ── audio: progress / pause UI ────────────────────────────────────────────
audio.addEventListener("timeupdate", () => {
  elTCur.textContent = fmtDur(audio.currentTime);
  if (audio.duration) elBarFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});
audio.addEventListener("loadedmetadata", () => {
  elTDur.textContent = fmtDur(audio.duration);
});
audio.addEventListener("play",  () => { playerPanel.classList.remove("paused"); setStatus("playing"); });
audio.addEventListener("pause", () => { playerPanel.classList.add("paused");    setStatus("paused"); });
audio.addEventListener("ended", async () => {
  setStatus("loading…");
  try {
    const r = await fetch("/api/advance", { method: "POST" }).then(r => r.json());
    renderNow(r.current);
  } catch { setStatus("advance failed"); }
});
elBar.addEventListener("click", (e) => {
  if (!audio.duration) return;
  const rect = elBar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

// volume — persisted. baseVolume tracks the user's intent so we can duck and
// return to the right level even if TTS fires while they're mid-adjustment.
let baseVolume = Number(localStorage.getItem("fishio.vol") || 80) / 100;
vol.value = Math.round(baseVolume * 100);
audio.volume = baseVolume;
ttsAudio.volume = 1.0;   // TTS always full — ducking is on the music side only

vol.addEventListener("input", () => {
  baseVolume = vol.value / 100;
  if (!ttsPlaying) audio.volume = baseVolume;   // don't override duck mid-speech
  localStorage.setItem("fishio.vol", vol.value);
});

// ── transport buttons ─────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
btnPrev.addEventListener("click", () => { audio.currentTime = 0; });
btnNext.addEventListener("click", async () => {
  const r = await fetch("/api/skip", { method: "POST" }).then(r => r.json());
  renderNow(r.current);
});
btnStop.addEventListener("click", () => {
  audio.pause(); audio.currentTime = 0;
});

btnFav.addEventListener("click", async () => {
  console.log("[btn-fav] click; current =", current);
  if (!current) { flashStatus("nothing playing"); return; }
  const wasFav = inList(library.favorites, current);
  const ep = wasFav ? "/api/unfavorite" : "/api/favorite";
  try {
    await fetch(ep, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: current.id, query: current.query, name: current.name, artists: current.artists }),
    });
  } catch (e) { console.error("[btn-fav]", e); flashStatus("fav failed"); return; }
  // optimistic; WS will confirm
  if (wasFav) library.favorites = library.favorites.filter(x => trackKey(x) !== trackKey(current));
  else        library.favorites = [...library.favorites, current];
  refreshFavButton();
  renderLibrary();
  flashStatus(wasFav ? "unfavorited" : "favorited");
});

function flashStatus(s) {
  const prev = elStatus.textContent;
  setStatus(s);
  setTimeout(() => { if (elStatus.textContent === s.toUpperCase()) setStatus(prev || ""); }, 1200);
}

// HIDE is now a UI toggle — collapses the player into a small chip.
// "Never play again" lives on the 👎 button (btn-ban).
function setPlayerVisible(visible) {
  playerPanelEl.hidden = !visible;
  playerChip.hidden    = visible;
  localStorage.setItem("fishio.playerVisible", visible ? "1" : "0");
}
btnHide.addEventListener("click",   () => setPlayerVisible(false));
playerChip.addEventListener("click",() => setPlayerVisible(true));
setPlayerVisible(localStorage.getItem("fishio.playerVisible") !== "0");

btnBan.addEventListener("click", async () => {
  console.log("[btn-ban] click; current =", current);
  if (!current) { flashStatus("nothing playing"); return; }
  if (!confirm(`Never play "${current.name || current.query}" again?`)) return;
  try {
    const r = await fetch("/api/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: current.id, query: current.query, name: current.name, artists: current.artists }),
    }).then(r => r.json());
    renderNow(r.current);
    flashStatus("banned");
  } catch (e) { console.error("[btn-ban]", e); flashStatus("ban failed"); }
});

// Lyric overlay — pulls from /api/lyric on click, renders the (cleaned) LRC.
btnLyric.addEventListener("click", async () => {
  console.log("[btn-lyric] click; current =", current);
  if (!current) { flashStatus("nothing playing"); return; }
  if (!current.id) { flashStatus("no song id"); return; }
  lyricName.textContent = `${current.name || current.query} — ${(current.artists || []).join(" / ")}`;
  lyricBody.textContent = "loading…";
  lyricModal.setAttribute("aria-hidden", "false");
  try {
    const r = await fetch(`/api/lyric?id=${encodeURIComponent(current.id)}`).then(r => r.json());
    lyricBody.textContent = (r.lyric || "").trim() || "(no lyric available)";
  } catch (e) { lyricBody.textContent = "(failed to load: " + e.message + ")"; }
});
lyricModal.querySelectorAll("[data-close-lyric]").forEach(el =>
  el.addEventListener("click", () => lyricModal.setAttribute("aria-hidden", "true"))
);

// ── chat ──────────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  btnSend.disabled = true;
  setStatus("thinking…");
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text }),
    }).then(r => r.json());

    // WS already pushed "say" + "enqueue" + "tts" — these are belt-and-suspenders.
    if (r.tts_url && r.say) lastTtsByText.set(r.say, r.tts_url);
    if (r.reason?.startsWith("brain error")) setStatus("brain offline");
  } catch (err) {
    setStatus("request failed");
  } finally {
    btnSend.disabled = false;
    input.focus();
  }
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

// ── settings drawer ───────────────────────────────────────────────────────
function openDrawer() {
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
  drawerScrim.hidden = false;
  refreshSettings();
}
function closeDrawer() {
  drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
  drawerScrim.hidden = true;
  stopQrPoll();
}
btnSettings.addEventListener("click", openDrawer);
btnCloseSet.addEventListener("click", closeDrawer);
drawerScrim.addEventListener("click", closeDrawer);

async function refreshSettings() {
  // Autopilot state
  try {
    const a = await fetch("/api/autopilot").then(r => r.json());
    const tog = document.getElementById("autopilot-toggle");
    tog.checked = !a.off;
    tog.onchange = async () => {
      await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ off: !tog.checked }),
      });
    };
  } catch {}

  // NCM login status
  try {
    const s = await fetch("/api/ncm/login/status").then(r => r.json());
    renderNcmStatus(s);
  } catch { ncmStatusEl.textContent = "Status check failed."; }
  // library
  try {
    const lib = await fetch("/api/library").then(r => r.json());
    library = lib;
    renderLibrary();
    refreshFavButton();
  } catch {}
  // meta: live config + weather snapshot
  try {
    const m = await fetch("/api/meta").then(r => r.json());
    voiceIdEl.textContent   = m.voice_id ? `${m.voice_id} (${m.voice_model})` : "not set";
    cityEl.textContent      = m.city || "not set";
    weatherStat.textContent = m.weather_now || (m.weather_configured ? "loading…" : "not configured");
  } catch {
    voiceIdEl.textContent = "(failed)";
    weatherStat.textContent = "(failed)";
  }
}

function renderNcmStatus(s) {
  if (s.loggedIn) {
    const vipLabel = s.vipType > 0 ? `VIP (type ${s.vipType})` : "free account";
    ncmStatusEl.innerHTML = `Logged in as <strong>${escapeHtml(s.nickname || "?")}</strong> · ${vipLabel}`;
    btnNcmLogin.hidden = true;
    btnNcmLogout.hidden = false;
    ncmQrEl.hidden = true;
  } else {
    ncmStatusEl.textContent = "Not logged in. VIP / paid-catalog tracks will be skipped.";
    btnNcmLogin.hidden = false;
    btnNcmLogout.hidden = true;
  }
}

function renderLibrary() {
  favCount.textContent = library.favorites.length;
  blCount.textContent  = library.blacklist.length;
  favList.innerHTML = "";
  blList.innerHTML  = "";
  for (const t of library.favorites.slice().reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><button data-act="unfav" data-q="${escapeHtml(t.query)}">Remove</button>`;
    li.querySelector("span").textContent = t.query || t.name;
    li.querySelector("button").addEventListener("click", async () => {
      await fetch("/api/unfavorite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
      library.favorites = library.favorites.filter(x => trackKey(x) !== trackKey(t));
      refreshFavButton(); renderLibrary();
    });
    favList.appendChild(li);
  }
  for (const t of library.blacklist.slice().reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><button data-act="unhide">Unhide</button>`;
    li.querySelector("span").textContent = t.query || t.name;
    li.querySelector("button").addEventListener("click", async () => {
      await fetch("/api/unhide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
      library.blacklist = library.blacklist.filter(x => trackKey(x) !== trackKey(t));
      renderLibrary();
    });
    blList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// NCM QR login flow
btnNcmLogin.addEventListener("click", async () => {
  try {
    const r = await fetch("/api/ncm/login/start", { method: "POST" }).then(r => r.json());
    if (r.error) { ncmStatusEl.textContent = "Start failed: " + r.error; return; }
    qrKey = r.key;
    ncmQrImg.src = r.qrimg;
    ncmQrEl.hidden = false;
    ncmQrMsg.textContent = "Waiting for scan…";
    startQrPoll();
  } catch (e) { ncmStatusEl.textContent = "Start failed: " + e.message; }
});

btnNcmLogout.addEventListener("click", async () => {
  await fetch("/api/ncm/logout", { method: "POST" });
  refreshSettings();
});

function startQrPoll() {
  stopQrPoll();
  qrPollTimer = setInterval(async () => {
    if (!qrKey) return;
    try {
      const r = await fetch(`/api/ncm/login/check?key=${encodeURIComponent(qrKey)}`).then(r => r.json());
      // 800 expired, 801 waiting, 802 scanned, 803 authorized
      if (r.code === 800) { ncmQrMsg.textContent = "QR expired. Press Scan to retry."; stopQrPoll(); }
      else if (r.code === 801) ncmQrMsg.textContent = "Waiting for scan…";
      else if (r.code === 802) ncmQrMsg.textContent = "Scanned — confirm on your phone…";
      else if (r.code === 803) { ncmQrMsg.textContent = "Logged in!"; stopQrPoll(); refreshSettings(); }
    } catch {}
  }, 2000);
}
function stopQrPoll() {
  if (qrPollTimer) clearInterval(qrPollTimer);
  qrPollTimer = null;
}

// ── WebSocket stream ──────────────────────────────────────────────────────
let wsBackoff = 1000;
function connectStream() {
  setWsState("connecting"); setFooter("connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/stream`);
  ws.addEventListener("open", () => {
    wsBackoff = 1000; setWsState("live"); setFooter("connected");
  });
  ws.addEventListener("message", (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case "snapshot":
        renderNow(msg.current); renderQueue(msg.queue || []); break;
      case "enqueue":
      case "advance":
        if (msg.type === "advance" && msg.current) appendNowPlayingLine(msg.current);
        renderNow(msg.current); renderQueue(msg.queue || []); break;
      case "say":
        appendSayMsg(msg.text, msg.ts || Date.now()); break;
      case "tts":
        if (msg.text) lastTtsByText.set(msg.text, msg.url);
        // attach the URL to the most recent message bubble if it matches
        const lastBubble = elLog.querySelector(".msg:last-child .replay");
        if (lastBubble) { lastBubble.disabled = false; lastBubble.style.opacity = "1"; }
        playTts(msg.url);
        break;
      case "library":
        library = { favorites: msg.favorites || [], blacklist: msg.blacklist || [] };
        renderLibrary(); refreshFavButton(); break;
      case "history-cleared":
        elLog.innerHTML = '<div class="log-meta">History cleared.</div>'; break;
    }
  });
  ws.addEventListener("close", () => {
    setWsState("offline"); setFooter("reconnecting");
    setTimeout(connectStream, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 2, 15_000);
  });
}
connectStream();

// initial library fetch (in case WS lags)
fetch("/api/library").then(r => r.json()).then(lib => { library = lib; renderLibrary(); refreshFavButton(); }).catch(() => {});

// ── DJ profile modal ──────────────────────────────────────────────────────
const djModal = document.getElementById("dj-modal");

async function openDjModal() {
  djModal.setAttribute("aria-hidden", "false");
  try {
    const m = await fetch("/api/me").then(r => r.json());
    document.getElementById("me-voice").textContent   = m.voice_id ? `${m.voice_id}  ·  ${m.voice_model}` : "not set";
    document.getElementById("me-weather").textContent = m.weather_now || "(weather not set)";
    document.getElementById("me-city").textContent    = m.city || "—";
    document.getElementById("me-today").textContent   = m.plays_today;
    document.getElementById("me-total").textContent   = m.plays_total;
    document.getElementById("me-favs").textContent    = m.favorites;
    document.getElementById("me-hidden").textContent  = m.blacklist;

    const ul = document.getElementById("me-artists");
    ul.innerHTML = "";
    if (m.top_artists.length === 0) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="muted small">(no listening data yet — chat with Fishio to start)</span>`;
      ul.appendChild(li);
    } else {
      for (const a of m.top_artists) {
        const li = document.createElement("li");
        li.innerHTML = `<span></span><span class="muted">${a.plays}×</span>`;
        li.querySelector("span").textContent = a.name;
        ul.appendChild(li);
      }
    }

    const lan = document.getElementById("me-lan");
    lan.innerHTML = "";
    // Only show wifi / wired / other interfaces. VPN tunnels and virtual
    // adapters are not phone-reachable on the same network.
    const usable = m.lan_urls.filter(u => u.kind === "wifi" || u.kind === "wired" || u.kind === "other");
    const shown  = usable.length ? usable : m.lan_urls;
    if (shown.length === 0) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="muted small">no LAN interface found</span>`;
      lan.appendChild(li);
    } else {
      for (const u of shown) {
        const li = document.createElement("li");
        const tag = u.kind === "wifi" ? "📶 " : (u.kind === "wired" ? "🔌 " : "");
        li.textContent = tag + u.url;
        li.title = `Click to copy · ${u.iface} · ${u.kind}`;
        li.addEventListener("click", () => {
          navigator.clipboard?.writeText(u.url);
          const o = li.textContent;
          li.textContent = "copied ✓";
          setTimeout(() => { li.textContent = o; }, 900);
        });
        lan.appendChild(li);
      }
      if (usable.length < m.lan_urls.length) {
        const note = document.createElement("li");
        note.className = "muted small";
        note.innerHTML = `<span class="muted small">(${m.lan_urls.length - usable.length} VPN/virtual adapter${m.lan_urls.length - usable.length > 1 ? "s" : ""} hidden)</span>`;
        lan.appendChild(note);
      }
    }
  } catch (e) { console.warn("/api/me failed:", e); }
}

function closeDjModal() { djModal.setAttribute("aria-hidden", "true"); }

djModal.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", closeDjModal));
document.getElementById("modal-open-settings").addEventListener("click", () => {
  closeDjModal();
  openDrawer();
});
document.getElementById("modal-clear-history").addEventListener("click", async () => {
  if (!confirm("Clear all chat messages? Favorites and hidden tracks will stay.")) return;
  await fetch("/api/history/clear", { method: "POST" });
  elLog.innerHTML = '<div class="log-meta">Cleared. Say something to Fishio to start fresh.</div>';
  closeDjModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (djModal.getAttribute("aria-hidden")    === "false") closeDjModal();
  if (lyricModal.getAttribute("aria-hidden") === "false") lyricModal.setAttribute("aria-hidden", "true");
});

// Delegated click handler — any DJ avatar in the log feed opens the modal.
elLog.addEventListener("click", (e) => {
  const av = e.target.closest(".avatar");
  if (av) openDjModal();
});

// ── Service worker (lets phones "Add to Home Screen" cleanly) ─────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* not critical */ });
}

// ── Web Speech API: voice input ───────────────────────────────────────────
// Chrome / Edge ship this; Firefox does not. We bind it when available.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (SR) {
  btnMic.disabled = false;
  btnMic.title = "Voice input (click to start, click again to stop)";
  btnMic.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    // Detect language by the script the input box currently contains, else en.
    rec.lang = (input.value && /[一-鿿]/.test(input.value)) ? "zh-CN" : (localStorage.getItem("fishio.speechLang") || "en-US");
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join("");
      input.value = text;
    };
    rec.onend = () => {
      btnMic.classList.remove("listening");
      rec = null;
      // Auto-submit if speech produced text — feels like a real walkie-talkie.
      if (input.value.trim()) form.requestSubmit();
    };
    rec.onerror = () => { btnMic.classList.remove("listening"); rec = null; };
    rec.start();
    btnMic.classList.add("listening");
  });
} else {
  btnMic.title = "Voice input not supported in this browser (try Chrome / Edge)";
}

// ── Playlist import (Settings drawer) ─────────────────────────────────────
const importBucket  = $("import-bucket");
const importText    = $("import-text");
const btnImport     = $("btn-import");
const importResult  = $("import-result");
btnImport.addEventListener("click", async () => {
  const text = importText.value.trim();
  if (!text) { importResult.textContent = "(paste some lines first)"; return; }
  btnImport.disabled = true;
  importResult.textContent = "importing…";
  try {
    const r = await fetch("/api/taste/playlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bucket: importBucket.value, text }),
    }).then(r => r.json());
    if (r.error) importResult.textContent = "failed: " + r.error;
    else {
      importResult.textContent = `added ${r.added} (bucket ${r.bucket} now ${r.total})`;
      importText.value = "";
    }
  } catch (e) {
    importResult.textContent = "failed: " + e.message;
  } finally {
    btnImport.disabled = false;
  }
});
