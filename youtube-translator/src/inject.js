// Runs in the page's MAIN world so it can read YouTube's own JS globals.
// On request from the content script, it reads the caption track list from
// ytInitialPlayerResponse and posts it back via window.postMessage.
(() => {
  "use strict";

  function readTracks() {
    try {
      const pr =
        window.ytInitialPlayerResponse ||
        (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args &&
          safeParse(window.ytplayer.config.args.raw_player_response));
      if (!pr) return null;

      const details = pr.videoDetails || {};
      const tl =
        pr.captions && pr.captions.playerCaptionsTracklistRenderer;
      const tracks =
        tl && Array.isArray(tl.captionTracks) ? tl.captionTracks : [];

      return {
        videoId: details.videoId || null,
        isLive: !!details.isLiveContent || !!details.isLive,
        tracks: tracks.map((t) => ({
          baseUrl: t.baseUrl,
          languageCode: t.languageCode || "",
          kind: t.kind || "", // "asr" = auto-generated
          name:
            (t.name &&
              (t.name.simpleText ||
                (t.name.runs && t.name.runs[0] && t.name.runs[0].text))) ||
            "",
        })),
      };
    } catch (_e) {
      return null;
    }
  }

  function safeParse(s) {
    try {
      return JSON.parse(s);
    } catch (_e) {
      return null;
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__ytrt !== "req-tracks") return;
    window.postMessage({ __ytrt: "tracks", reqId: ev.data.reqId, payload: readTracks() }, "*");
  });
})();
