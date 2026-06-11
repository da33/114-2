# YouTube 即時翻譯字幕（瀏覽器插件）

在 YouTube 觀看影片時，把各國語言的字幕**即時翻譯成繁體中文**（也可改成其他語言）並顯示在畫面下方。支援上傳字幕、自動產生字幕、以及直播字幕。

> 適用：Chrome、Edge、Brave 等 Chromium 系瀏覽器（Manifest V3）。

## 功能

- 即時監看 YouTube 原生字幕，翻成你設定的語言（預設繁體中文 `zh-TW`）
- 可選擇**同時顯示原文 + 譯文**，方便對照學語言
- 可調整字級
- 翻譯結果會快取，重複的字幕不會重複翻、反應更快
- **完全免費**：免 API key、免註冊、安裝即用（使用 Google 翻譯的公開端點）
- 內建免費備援：Google 端點偶爾被限流時，自動改用 Lingva（開源免費的翻譯代理），全程不需付費

## 安裝（載入未封裝的擴充功能）

1. 下載/clone 本資料夾 `youtube-translator/` 到電腦
2. 開啟瀏覽器，網址列輸入 `chrome://extensions`（Edge 為 `edge://extensions`）
3. 右上角開啟「**開發人員模式 / Developer mode**」
4. 點「**載入未封裝項目 / Load unpacked**」，選擇 `youtube-translator/` 資料夾
5. 安裝完成，工具列會出現紅色圖示

## 使用方式

1. 打開任一支 YouTube 影片
2. **在播放器右下角開啟「字幕 (CC)」**（這一步很重要，插件是翻譯 YouTube 的字幕）
   - 如果原影片沒有字幕，可在「設定（齒輪）→ 字幕 → 自動翻譯／自動產生」先開字幕
3. 字幕出現後，畫面下方就會顯示繁體中文翻譯
4. 點工具列的插件圖示可調整：開關、目標語言、是否顯示原文、字級

## 運作原理

```
YouTube 字幕 DOM (.ytp-caption-segment)
        │  MutationObserver 監看文字變化
        ▼
content.js  ──sendMessage──▶  background.js
        ▲                         │ 呼叫 translate.googleapis.com（含快取）
        └────── 譯文回傳 ─────────┘
        ▼
畫面下方覆蓋層顯示「原文 / 譯文」
```

- `src/content.js`：注入到 YouTube 頁面，監看字幕、顯示翻譯覆蓋層
- `src/background.js`：service worker，呼叫翻譯 API 並做記憶體快取
- `popup/`：工具列的設定面板
- 翻譯請求集中在 background 處理，避開網頁的 CORS 限制

## 隱私

- 只有「目前顯示的字幕文字」會被送到 Google 翻譯端點以取得譯文
- 設定值存在瀏覽器本機（`chrome.storage.sync`），不會上傳到第三方伺服器
- 插件只在 `*.youtube.com` 上執行

## 已知限制與後續可擴充

- 使用的都是**免費端點**（Google 公開端點 + Lingva 備援），不需要任何付費或 API key。
  量極大時仍可能短暫被限流，但備援機制 + 快取已大幅降低發生機率
- 想再加更多免費備援，可自架 [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate)（開源免費）後加入 `background.js` 的備援清單
- 自動字幕是逐字增長的，本插件以 ~350ms 去抖動後翻譯整行，已兼顧反應速度與翻譯次數
- 若要做成可上架的版本，需補上更完整的圖示與商店素材

## 開發者：替換或新增翻譯後端

翻譯後端集中在 `src/background.js`：
`translateWithFallback()` 會依序嘗試 `googleTranslate()` → 各個 Lingva 實例。
要新增免費後端，寫一個回傳 `{ translated, detected }` 的函式並加進備援順序即可，
其他程式碼不需更動。
