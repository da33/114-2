# YouTube 即時翻譯字幕（瀏覽器插件）

在 YouTube 觀看影片時，把各國語言的字幕**即時翻譯成繁體中文**（也可改成其他語言）並顯示在畫面下方。支援上傳字幕、自動產生字幕、以及直播字幕。

> 適用：Chrome、Edge、Brave 等 Chromium 系瀏覽器（Manifest V3）。

## 功能

- **預先翻譯（零延遲）**：打開一般影片時，直接抓整份字幕檔、整批翻好，照時間碼顯示，
  播放幾乎沒有延遲，**不需手動開 CC**
- **即時模式（後備）**：直播或抓不到字幕檔時，自動退回「看一句翻一句」的即時翻譯
- 即時監看 YouTube 原生字幕，翻成你設定的語言（預設繁體中文 `zh-TW`）
- **兩種翻譯引擎可切換（都免費）**：
  - **Google**：免設定、即裝即用、速度快（預設）
  - **Gemini AI**：翻得更自然、懂前後文與語氣，需貼上免費 API key；超量時自動退回 Google
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
2. 一般影片會自動進入**預先翻譯模式**：抓整份字幕、整批翻好，畫面下方即時顯示繁中翻譯
   （**不必手動開 CC**；只要該影片本身有字幕或自動字幕即可）
3. 直播或抓不到字幕檔的影片會自動退回**即時模式**——此時請在播放器右下角開啟「字幕 (CC)」
4. 點工具列的插件圖示可調整：翻譯引擎、目標語言、是否顯示原文、字級

> 兩種模式會自動切換，你不用手動選。一般影片＝零延遲；直播＝即時翻譯（會有 YouTube 字幕本身的延遲）。

### 升級成 Gemini AI 翻譯（免費，品質更好）

1. 到 [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 用 Google 帳號登入
2. 按「Create API key」，複製產生的 key（**免費、不需綁信用卡**）
3. 點插件圖示 → 「翻譯引擎」選 **Gemini AI** → 把 key 貼進欄位
4. 之後字幕就會用 Gemini 翻譯，更自然、更懂前後文

> Gemini 免費方案有每分鐘/每天用量上限。本插件會傳最近幾行字幕當作前後文以提升品質，
> 並對重複字幕做快取以節省額度；萬一超量或出錯，會**自動退回 Google**，字幕不會中斷。
> API key 只存在你的瀏覽器本機（`chrome.storage.sync`），不會傳給第三方。

## 運作原理

```
預先翻譯模式（一般影片）
  inject.js (MAIN world) 讀取 ytInitialPlayerResponse 的字幕軌清單
        │  postMessage
        ▼
  content.js 抓整份字幕檔(timedtext json3) → 建立時間軸
        │  translateBatch
        ▼
  background.js 整批翻譯(Google 併發 / Gemini 分批編號)，含快取
        ▼
  影片 timeupdate → 依時間碼顯示對應「原文 / 譯文」(零延遲)

即時模式（直播 / 抓不到字幕時自動後備）
  MutationObserver 監看 .ytp-caption-segment → 逐句即時翻譯
```

- `src/inject.js`：跑在頁面 MAIN world，讀取 YouTube 的字幕軌資料回傳給 content
- `src/content.js`：主控；預先翻譯時間軸顯示，失敗時退回即時監看
- `src/background.js`：service worker，單句與整批翻譯、多引擎與快取
- `popup/`：工具列的設定面板
- 翻譯請求集中在 background 處理，避開網頁的 CORS 限制

## 隱私

- 只有「目前顯示的字幕文字」（Gemini 模式下含最近幾行作為前後文）會被送到所選的翻譯服務以取得譯文
- 設定值與 API key 都存在瀏覽器本機（`chrome.storage.sync`），不會上傳到第三方伺服器
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
