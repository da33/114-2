// Popup settings: read/write chrome.storage.sync. Changes apply live because
// the content script listens to chrome.storage.onChanged.

const DEFAULTS = {
  enabled: true,
  targetLang: "zh-TW",
  showOriginal: true,
  fontSize: 24,
};

const el = {
  enabled: document.getElementById("enabled"),
  targetLang: document.getElementById("targetLang"),
  showOriginal: document.getElementById("showOriginal"),
  fontSize: document.getElementById("fontSize"),
  fontSizeVal: document.getElementById("fontSizeVal"),
};

function render(s) {
  el.enabled.checked = !!s.enabled;
  el.targetLang.value = s.targetLang;
  el.showOriginal.checked = !!s.showOriginal;
  el.fontSize.value = s.fontSize;
  el.fontSizeVal.textContent = s.fontSize;
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
