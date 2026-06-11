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
    debounceMs: 350,
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
      if (!settings.enabled) clearOverlay();
    });
  } catch (_e) {
    /* storage may be unavailable in some frames */
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
    const text = readCaptionText();

    if (!text) {
      // Captions cleared between lines — hide the overlay.
      if (overlay) overlay.style.opacity = "0";
      lastSentText = "";
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

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => requestTranslation(text), settings.debounceMs);
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

  // ---- Boot ---------------------------------------------------------------
  async function init() {
    await loadSettings();
    watchCaptions();
    // YouTube is a SPA; re-check the overlay when navigating between videos.
    window.addEventListener("yt-navigate-finish", () => {
      lastSentText = "";
      lastRenderedOriginal = "";
      contextLines.length = 0;
      clearOverlay();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
