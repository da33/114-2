// Background service worker:
// - Receives translation requests from content scripts
// - Calls free, no-API-key translation endpoints with automatic fallback:
//     1. translate.googleapis.com (gtx)  2. Lingva instances
// - Caches results in-memory to avoid re-translating repeated caption lines

const CACHE = new Map();          // key: `${tl}::${text}` -> translated string
const MAX_CACHE = 2000;

function cacheKey(text, tl, engine) {
  return `${engine || "google"}::${tl}::${text}`;
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

// Human-readable target language names for the AI prompt.
const LANG_NAMES = {
  "zh-TW": "Traditional Chinese (Taiwan)",
  "zh-CN": "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  vi: "Vietnamese",
  th: "Thai",
};

// AI engine: Google Gemini (free tier via Google AI Studio API key).
// Produces more natural, context-aware translations than the plain
// Translate endpoint. Context (recent lines) is passed in to disambiguate
// pronouns and carry tone across subtitle lines.
async function geminiTranslate(text, targetLang, apiKey, context, model) {
  const langName = LANG_NAMES[targetLang] || targetLang;
  const mdl = model || "gemini-2.0-flash";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(mdl) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  const contextBlock =
    context && context.length
      ? "Earlier lines (context, do NOT translate these):\n" +
        context.join("\n") +
        "\n\n"
      : "";

  const prompt =
    "You are translating live video subtitles into " +
    langName +
    ". Translate ONLY the line after 'LINE:' into natural, fluent " +
    langName +
    ", matching the spoken, casual tone. Use the context to resolve pronouns " +
    "and keep terminology consistent. Output ONLY the translation text with no " +
    "quotes, no labels, no explanation.\n\n" +
    contextBlock +
    "LINE: " +
    text;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("gemini http " + res.status);
  const data = await res.json();

  const parts =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts;
  let translated = "";
  if (Array.isArray(parts)) {
    for (const p of parts) if (p && typeof p.text === "string") translated += p.text;
  }
  translated = translated.trim();
  if (!translated) throw new Error("gemini empty result");
  return { translated, detected: "auto" };
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
  const useGemini = payload.engine === "gemini" && payload.geminiApiKey;
  const engine = useGemini ? "gemini" : "google";

  if (!text) {
    sendResponse({ ok: true, translated: "", detected: "auto", cached: true });
    return;
  }

  const key = cacheKey(text, targetLang, engine);
  if (CACHE.has(key)) {
    sendResponse({ ok: true, translated: CACHE.get(key), detected: "cache", cached: true, engine });
    return;
  }

  // Preferred engine first; if the AI engine fails (rate limit, bad key,
  // network), fall back to the free Translate endpoints so subtitles never
  // go blank.
  try {
    let result;
    if (useGemini) {
      try {
        result = await geminiTranslate(
          text,
          targetLang,
          payload.geminiApiKey,
          payload.context,
          payload.geminiModel
        );
        rememberInCache(key, result.translated);
        sendResponse({ ok: true, translated: result.translated, detected: result.detected, cached: false, engine: "gemini" });
        return;
      } catch (aiErr) {
        // fall through to free engines below
        result = await translateWithFallback(text, targetLang);
        rememberInCache(cacheKey(text, targetLang, "google"), result.translated);
        sendResponse({ ok: true, translated: result.translated, detected: result.detected, cached: false, engine: "google", fellBack: true, aiError: String(aiErr && aiErr.message || aiErr) });
        return;
      }
    }
    result = await translateWithFallback(text, targetLang);
    rememberInCache(key, result.translated);
    sendResponse({ ok: true, translated: result.translated, detected: result.detected, cached: false, engine: "google" });
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
