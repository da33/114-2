// Background service worker:
// - Receives translation requests from content scripts
// - Calls free, no-API-key translation endpoints with automatic fallback:
//     1. translate.googleapis.com (gtx)  2. Lingva instances
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
  if (!translated) throw new Error("google empty result");
  return { translated, detected };
}

// Free fallback: Lingva (open-source Google Translate front-end).
// API shape: GET /api/v1/{source}/{target}/{query} -> { translation }
const LINGVA_INSTANCES = [
  "https://lingva.ml",
  "https://translate.plausibility.cloud",
];

async function lingvaTranslate(text, targetLang, base) {
  // Lingva uses zh for Traditional Chinese and zh_HANS for Simplified
  const tl = targetLang === "zh-TW" ? "zh" :
             targetLang === "zh-CN" ? "zh_HANS" : targetLang;
  const url = base + "/api/v1/auto/" + encodeURIComponent(tl) +
              "/" + encodeURIComponent(text);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error("lingva http " + res.status);
  const data = await res.json();
  if (!data || typeof data.translation !== "string" || !data.translation) {
    throw new Error("lingva empty result");
  }
  return { translated: data.translation, detected: (data.info && data.info.detectedSource) || "auto" };
}

// Tries each free provider in order until one succeeds.
async function translateWithFallback(text, targetLang) {
  let lastErr;
  try {
    return await googleTranslate(text, targetLang);
  } catch (err) {
    lastErr = err;
  }
  for (const base of LINGVA_INSTANCES) {
    try {
      return await lingvaTranslate(text, targetLang, base);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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
    const { translated, detected } = await translateWithFallback(text, targetLang);
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
