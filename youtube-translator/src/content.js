// Content script injected on YouTube pages.
// Watches the native caption container, sends the text to the background
// worker for translation, and renders the translated line inside the player.

(() => {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    targetLang: "zh-TW",
    showOriginal: true,
    fontSize: 24,
    hideNative: true,        // hide YouTube's own captions to avoid overlap
    engine: "google",        // "google" (free, no key) or "gemini" (free AI)
    geminiApiKey: "",
    geminiModel: "gemini-2.0-flash",
  };

  let settings = { ...DEFAULTS };

  // ---- Settings -----------------------------------------------------------
  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (stored) => {
          settings = { ...DEFAULTS, ...(stored || {}) };
          resolve(settings);
        });
      } catch (_e) {
        resolve(settings);
      }
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const k of Object.keys(changes)) {
        settings[k] = changes[k].newValue;
      }
      applyOverlayStyle();
      applyHideNative();
      if (!settings.enabled) {
        teardownTimeline();
        clearOverlay();
        return;
      }
      // Changing what/how we translate means the prefetched transcript must be
      // re-fetched and re-translated.
      if (
        changes.targetLang ||
        changes.engine ||
        changes.geminiApiKey ||
        changes.geminiModel ||
        changes.enabled
      ) {
        setupForCurrentVideo();
      }
    });
  } catch (_e) {
    /* storage may be unavailable in some frames */
  }

  // Hide YouTube's own caption text (we still read it from the DOM) so it does
  // not overlap with our translation overlay. Toggled by a class on <html>.
  function applyHideNative() {
    const on = settings.enabled && settings.hideNative;
    document.documentElement.classList.toggle("yt-rt-hide-native", on);
  }

  // ---- Overlay ------------------------------------------------------------
  let overlay = null;       // container appended to the player
  let origLine = null;      // original-text line
  let transLine = null;     // translated-text line

  function ensureOverlay() {
    const player =
      document.querySelector(".html5-video-player") ||
      document.getElementById("movie_player");
    if (!player) return null;

    if (overlay && overlay.isConnected) return overlay;

    overlay = document.createElement("div");
    overlay.className = "yt-rt-translator-overlay";

    origLine = document.createElement("div");
    origLine.className = "yt-rt-original";

    transLine = document.createElement("div");
    transLine.className = "yt-rt-translated";

    overlay.appendChild(origLine);
    overlay.appendChild(transLine);
    player.appendChild(overlay);
    applyOverlayStyle();
    return overlay;
  }

  function applyOverlayStyle() {
    if (transLine) transLine.style.fontSize = settings.fontSize + "px";
    if (origLine) {
      origLine.style.fontSize = Math.round(settings.fontSize * 0.72) + "px";
      origLine.style.display = settings.showOriginal ? "block" : "none";
    }
  }

  function clearOverlay() {
    if (origLine) origLine.textContent = "";
    if (transLine) transLine.textContent = "";
    if (overlay) overlay.style.opacity = "0";
  }

  function renderTranslation(originalText, translatedText) {
    const ov = ensureOverlay();
    if (!ov) return;
    origLine.textContent = settings.showOriginal ? originalText : "";
    transLine.textContent = translatedText || "";
    ov.style.opacity = translatedText ? "1" : "0";
    applyOverlayStyle();
  }

  // ---- Caption reading ----------------------------------------------------
  function readCaptionText() {
    // YouTube renders each visible caption line as .ytp-caption-segment
    const segs = document.querySelectorAll(".ytp-caption-segment");
    if (!segs.length) return "";
    let text = "";
    segs.forEach((s) => {
      text += s.textContent;
    });
    return text.replace(/\s+/g, " ").trim();
  }

  // ---- Translation request (debounced) ------------------------------------
  let debounceTimer = null;
  let lastSentText = "";
  let lastRenderedOriginal = "";
  let reqSeq = 0;
  const contextLines = [];        // recent source lines, used by the AI engine
  const MAX_CONTEXT = 3;

  function requestTranslation(text) {
    const mySeq = ++reqSeq;
    chrome.runtime.sendMessage(
      {
        type: "translate",
        text,
        targetLang: settings.targetLang,
        engine: settings.engine,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
        context: contextLines.slice(),
      },
      (resp) => {
        if (chrome.runtime.lastError) return;       // worker asleep / context gone
        if (mySeq !== reqSeq) return;               // a newer line superseded this one
        if (!resp || !resp.ok) return;
        lastRenderedOriginal = text;
        renderTranslation(text, resp.translated);
        // Keep this line as context for the next translation request.
        contextLines.push(text);
        if (contextLines.length > MAX_CONTEXT) contextLines.shift();
      }
    );
  }

  function onCaptionChanged() {
    if (!settings.enabled) return;
    if (timelineActive) return; // prefetched transcript drives the display
    const text = readCaptionText();

    if (!text) {
      // Captions cleared between lines — hide the overlay.
      if (overlay) overlay.style.opacity = "0";
      lastSentText = "";
      clearTimeout(debounceTimer);
      return;
    }
    if (text === lastSentText) return;
    lastSentText = text;

    // Show the original immediately for responsiveness; translation follows.
    if (settings.showOriginal) {
      const ov = ensureOverlay();
      if (ov && text !== lastRenderedOriginal) {
        origLine.textContent = text;
        ov.style.opacity = "1";
      }
    }

    scheduleTranslation(text);
  }

  // Real-time leading-edge throttle: translate immediately when a caption
  // first changes, then at most once per interval while it keeps growing,
  // plus a trailing call to catch the final text. This tracks the caption
  // live instead of waiting for the speaker to pause.
  // The fast free Google endpoint can be hit aggressively; the AI engine is
  // rate-limited and slower, so it uses a longer interval.
  let lastReqAt = 0;
  function scheduleTranslation(text) {
    const interval = settings.engine === "gemini" ? 700 : 130;
    const since = Date.now() - lastReqAt;
    clearTimeout(debounceTimer);
    if (since >= interval) {
      lastReqAt = Date.now();
      requestTranslation(text);
    } else {
      debounceTimer = setTimeout(() => {
        lastReqAt = Date.now();
        requestTranslation(text);
      }, interval - since);
    }
  }

  // ---- Observe the caption container --------------------------------------
  let captionObserver = null;

  function watchCaptions() {
    if (captionObserver) return;
    captionObserver = new MutationObserver(() => onCaptionChanged());
    captionObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  // ========================================================================
  // Prefetch mode: download the whole caption track for the current (non-live)
  // video up front, translate it in one batch, then display lines by their
  // timestamp. This makes playback essentially zero-latency. Falls back to the
  // live observer mode above if the transcript can't be fetched, or for live
  // streams which have no complete transcript.
  // ========================================================================
  let timeline = [];           // [{ start, end, text, translated }]
  let timelineActive = false;
  let videoEl = null;
  let lastSegIdx = -1;
  let setupToken = 0;          // invalidates stale async setups on navigation

  // Ask the MAIN-world inject script for the caption track list.
  function requestTracks(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      let done = false;
      function onMsg(ev) {
        if (ev.source !== window || !ev.data || ev.data.__ytrt !== "tracks") return;
        if (ev.data.reqId && ev.data.reqId !== reqId) return;
        finish(ev.data.payload);
      }
      function finish(val) {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMsg);
        resolve(val);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ __ytrt: "req-tracks", reqId }, "*");
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  // Choose the source track to translate FROM: prefer a real (manual) track in
  // a language other than the target; otherwise fall back to auto-captions.
  function pickTrack(tracks, target) {
    if (!tracks || !tracks.length) return null;
    const base = (c) => (c || "").toLowerCase().split("-")[0];
    const tgt = base(target);
    const others = tracks.filter((t) => base(t.languageCode) !== tgt);
    const pool = others.length ? others : tracks;
    return pool.find((t) => t.kind !== "asr") || pool[0];
  }

  async function fetchTranscript(baseUrl) {
    const url = baseUrl + (baseUrl.indexOf("fmt=") >= 0 ? "" : "&fmt=json3");
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("transcript http " + res.status);
    const data = await res.json();
    const segs = [];
    if (data && Array.isArray(data.events)) {
      for (const ev of data.events) {
        if (!ev.segs) continue;
        const text = ev.segs
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) continue;
        const start = (ev.tStartMs || 0) / 1000;
        const dur = (ev.dDurationMs || 0) / 1000;
        segs.push({ start, end: start + dur, text, translated: "" });
      }
    }
    return segs;
  }

  function getVideoEl() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("#movie_player video") ||
      document.querySelector("video")
    );
  }

  function findSegIdx(t) {
    if (!timeline.length) return -1;
    let lo = 0, hi = timeline.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return -1;
    // Keep a small grace window past the line's end to avoid flicker in gaps.
    if (t <= timeline[ans].end + 0.5) return ans;
    return -1;
  }

  function onTimeUpdate() {
    if (!timelineActive) return;
    const v = videoEl;
    if (!v) return;
    const idx = findSegIdx(v.currentTime);
    if (idx === lastSegIdx) return;
    lastSegIdx = idx;
    if (idx < 0) {
      if (overlay) overlay.style.opacity = "0";
      return;
    }
    const seg = timeline[idx];
    renderTranslation(seg.text, seg.translated);
  }

  function attachTimeUpdate() {
    videoEl = getVideoEl();
    if (!videoEl) {
      setTimeout(attachTimeUpdate, 500);
      return;
    }
    videoEl.removeEventListener("timeupdate", onTimeUpdate);
    videoEl.addEventListener("timeupdate", onTimeUpdate);
  }

  function teardownTimeline() {
    timelineActive = false;
    timeline = [];
    lastSegIdx = -1;
    if (videoEl) videoEl.removeEventListener("timeupdate", onTimeUpdate);
    clearOverlay();
  }

  function translateTimeline(myToken) {
    const texts = timeline.map((s) => s.text);
    chrome.runtime.sendMessage(
      {
        type: "translateBatch",
        texts,
        targetLang: settings.targetLang,
        engine: settings.engine,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
      },
      (resp) => {
        if (chrome.runtime.lastError) return;
        if (myToken !== setupToken) return;       // navigated away
        if (!resp || !resp.ok || !Array.isArray(resp.translations)) return;
        for (let i = 0; i < timeline.length; i++) {
          if (resp.translations[i]) timeline[i].translated = resp.translations[i];
        }
        lastSegIdx = -1;
        onTimeUpdate();                            // refresh the current line
      }
    );
  }

  async function setupForCurrentVideo() {
    const myToken = ++setupToken;
    teardownTimeline();
    if (!settings.enabled) return;
    if (location.pathname !== "/watch") return;   // only real watch pages

    try {
      const info = await requestTracks();
      if (myToken !== setupToken) return;
      if (!info || info.isLive || !info.tracks || !info.tracks.length) return; // -> live mode
      const track = pickTrack(info.tracks, settings.targetLang);
      if (!track || !track.baseUrl) return;

      const segs = await fetchTranscript(track.baseUrl);
      if (myToken !== setupToken) return;
      if (!segs.length) return;                   // -> live mode

      timeline = segs;
      timelineActive = true;
      lastSegIdx = -1;
      attachTimeUpdate();
      onTimeUpdate();                             // show original immediately
      translateTimeline(myToken);                 // fill translations async
    } catch (_e) {
      // Any failure: leave timelineActive false so the live observer takes over.
      teardownTimeline();
    }
  }

  // ---- Boot ---------------------------------------------------------------
  async function init() {
    await loadSettings();
    applyHideNative();
    watchCaptions();
    setupForCurrentVideo();
    // YouTube is a SPA; re-run setup when navigating between videos.
    window.addEventListener("yt-navigate-finish", () => {
      lastSentText = "";
      lastRenderedOriginal = "";
      contextLines.length = 0;
      clearOverlay();
      // ytInitialPlayerResponse updates slightly after this event fires.
      setTimeout(setupForCurrentVideo, 300);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
