// Runs in the page's MAIN world so it can (a) read YouTube's JS globals,
// (b) intercept the caption data the YouTube player itself loads, and
// (c) ask the player to load a caption track.
//
// Fetching the timedtext URL ourselves is unreliable now (YouTube requires a
// per-session token the player holds), so instead we capture the player's OWN
// caption response — it is always correctly timed and authorized.
(() => {
  "use strict";
  const C = ["%c[YT-RT]", "color:#e23b3b;font-weight:bold"];
  console.log(...C, "inject.js (MAIN world) loaded");

  function post(type, extra) {
    window.postMessage(Object.assign({ __ytrt: type }, extra || {}), "*");
  }

  // Parse a timedtext json3 payload into timed segments.
  function parseJson3(text) {
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.events)) return null;
      const segs = [];
      for (const ev of data.events) {
        if (!ev.segs) continue;
        const t = ev.segs
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!t) continue;
        const start = (ev.tStartMs || 0) / 1000;
        const dur = (ev.dDurationMs || 0) / 1000;
        segs.push({ start, end: start + dur, text: t });
      }
      return segs.length ? segs : null;
    } catch (_e) {
      return null;
    }
  }

  function isTimedText(url) {
    return typeof url === "string" && url.indexOf("/api/timedtext") >= 0;
  }

  // --- Intercept fetch ---
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const a0 = args[0];
      const url = (a0 && a0.url) || a0 || "";
      if (isTimedText(url)) {
        p.then((r) => {
          r.clone()
            .text()
            .then((txt) => {
              const segs = parseJson3(txt);
              if (segs) {
                console.log(...C, "captured timedtext via fetch,", segs.length, "lines");
                post("transcript", { segs });
              }
            })
            .catch(() => {});
        }).catch(() => {});
      }
    } catch (_e) {}
    return p;
  };

  // --- Intercept XHR (older code paths) ---
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (_m, u) {
    this.__ytrtUrl = u;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      if (isTimedText(this.__ytrtUrl)) {
        this.addEventListener("load", () => {
          try {
            const segs = parseJson3(this.responseText);
            if (segs) {
              console.log(...C, "captured timedtext via xhr,", segs.length, "lines");
              post("transcript", { segs });
            }
          } catch (_e) {}
        });
      }
    } catch (_e) {}
    return XS.apply(this, arguments);
  };

  // Read the caption track list (languages available) for diagnostics.
  function readTracks() {
    try {
      const pr = window.ytInitialPlayerResponse;
      const details = (pr && pr.videoDetails) || {};
      const tl = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
      const tracks = tl && Array.isArray(tl.captionTracks) ? tl.captionTracks : [];
      return {
        videoId: details.videoId || null,
        isLive: !!details.isLiveContent || !!details.isLive,
        tracks: tracks.map((t) => ({
          languageCode: t.languageCode || "",
          kind: t.kind || "",
        })),
      };
    } catch (_e) {
      return null;
    }
  }

  // Ask the player to load a caption track, which triggers the timedtext
  // request we capture above. Prefer a non-target, manual track.
  function enableCaptions(targetLang) {
    try {
      const mp = document.getElementById("movie_player");
      if (!mp || typeof mp.getOption !== "function") return false;
      if (typeof mp.loadModule === "function") mp.loadModule("captions");
      let list =
        mp.getOption("captions", "tracklist", { includeAsr: true }) ||
        mp.getOption("captions", "tracklist") ||
        [];
      if (!list.length) return false;
      const base = (c) => (c || "").toLowerCase().split("-")[0];
      const tgt = base(targetLang);
      const others = list.filter((t) => base(t.languageCode) !== tgt);
      const pool = others.length ? others : list;
      const track = pool.find((t) => t.kind !== "asr") || pool[0];
      mp.setOption("captions", "track", track || {});
      console.log(...C, "enabled captions track:", track && track.languageCode, track && track.kind);
      return true;
    } catch (e) {
      console.log(...C, "enableCaptions error:", e && e.message);
      return false;
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.__ytrt === "req-tracks") {
      post("tracks", { reqId: ev.data.reqId, payload: readTracks() });
    } else if (ev.data.__ytrt === "req-enable") {
      enableCaptions(ev.data.targetLang);
    }
  });
})();
