// Popup settings: read/write chrome.storage.sync. Changes apply live because
// the content script listens to chrome.storage.onChanged.

const DEFAULTS = {
  enabled: true,
  targetLang: "zh-TW",
  showOriginal: true,
  fontSize: 24,
  engine: "google",
  geminiApiKey: "",
};

const el = {
  enabled: document.getElementById("enabled"),
  targetLang: document.getElementById("targetLang"),
  showOriginal: document.getElementById("showOriginal"),
  fontSize: document.getElementById("fontSize"),
  fontSizeVal: document.getElementById("fontSizeVal"),
  engine: document.getElementById("engine"),
  geminiBox: document.getElementById("geminiBox"),
  geminiApiKey: document.getElementById("geminiApiKey"),
};

function toggleGeminiBox() {
  el.geminiBox.hidden = el.engine.value !== "gemini";
}

function render(s) {
  el.enabled.checked = !!s.enabled;
  el.targetLang.value = s.targetLang;
  el.showOriginal.checked = !!s.showOriginal;
  el.fontSize.value = s.fontSize;
  el.fontSizeVal.textContent = s.fontSize;
  el.engine.value = s.engine;
  el.geminiApiKey.value = s.geminiApiKey || "";
  toggleGeminiBox();
}

function save(patch) {
  chrome.storage.sync.set(patch);
}

chrome.storage.sync.get(DEFAULTS, (s) => render({ ...DEFAULTS, ...s }));

el.enabled.addEventListener("change", () => save({ enabled: el.enabled.checked }));
el.targetLang.addEventListener("change", () => save({ targetLang: el.targetLang.value }));
el.showOriginal.addEventListener("change", () =>
  save({ showOriginal: el.showOriginal.checked })
);
el.fontSize.addEventListener("input", () => {
  el.fontSizeVal.textContent = el.fontSize.value;
  save({ fontSize: parseInt(el.fontSize.value, 10) });
});
el.engine.addEventListener("change", () => {
  toggleGeminiBox();
  save({ engine: el.engine.value });
});
el.geminiApiKey.addEventListener("change", () =>
  save({ geminiApiKey: el.geminiApiKey.value.trim() })
);
