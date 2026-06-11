// Background service worker:
// - Receives translation requests from content scripts
// - Calls the Google Translate free endpoint (no API key required)
// - Caches results in-memory to avoid re-translating repeated caption lines

const CACHE = new Map();          // key: `${tl}::${text}` -> translated string
const MAX_CACHE = 2000;

function cacheKey(text, tl) {
  return `${tl}::${text}`;
}

function rememberInCache(key, value) {
  CACHE.set(key, value);
  if (CACHE.size > MAX_CACHE) {
    // Drop the oldest entry (Map keeps insertion order)
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
}

// Calls translate.googleapis.com (the unofficial "gtx" endpoint used by the
// public Google Translate widget). Returns the translated text and detected
// source language.
async function googleTranslate(text, targetLang) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    "?client=gtx&sl=auto" +
    "&tl=" + encodeURIComponent(targetLang) +
    "&dt=t&q=" + encodeURIComponent(text);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error("translate http " + res.status);
  }
  const data = await res.json();

  // data[0] is an array of [translatedChunk, originalChunk, ...] tuples.
  // data[2] is the detected source language code.
  let translated = "";
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const chunk of data[0]) {
      if (chunk && typeof chunk[0] === "string") translated += chunk[0];
    }
  }
  const detected = (Array.isArray(data) && data[2]) || "auto";
  return { translated, detected };
}

async function handleTranslate(payload, sendResponse) {
  const text = (payload.text || "").trim();
  const targetLang = payload.targetLang || "zh-TW";

  if (!text) {
    sendResponse({ ok: true, translated: "", detected: "auto", cached: true });
    return;
  }

  const key = cacheKey(text, targetLang);
  if (CACHE.has(key)) {
    sendResponse({ ok: true, translated: CACHE.get(key), detected: "cache", cached: true });
    return;
  }

  try {
    const { translated, detected } = await googleTranslate(text, targetLang);
    rememberInCache(key, translated);
    sendResponse({ ok: true, translated, detected, cached: false });
  } catch (err) {
    sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "translate") {
    handleTranslate(msg, sendResponse);
    return true; // keep the message channel open for the async response
  }
  return false;
});
