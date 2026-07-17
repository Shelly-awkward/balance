# 交接文件：即時字幕 OpenAI 引擎（雲端 → 本機 session）

> 這份是給接手的**本機 Claude Code session** 看的。雲端 session 碰不到本機金鑰檔、
> 麥克風、分頁音訊，也無法部署 Cloudflare Worker，所以 OpenAI 這段交由本機完成。
> **完成後可刪掉這個檔案再合併 PR。**

## 背景

使用者聽力衰退，要一個**即時字幕聽力輔助工具**。痛點是系統內建即時字幕的三個死角：
關掉即失無法留存、不能複製到文件、繁體中文不支援翻譯。

分支：`claude/github-pages-url-yc2yz0`　draft PR：#4
上線網址：`https://shelly-awkward.github.io/balance/captions.html`

## 目前狀態（已完成、已在分支上）

- **`captions.html`** — 已可用。目前用瀏覽器 Web Speech API：
  - 即時字幕、逐字稿累積不消失、複製全部 / 下載 .txt / 本地自動保存
  - `中文`（放大不翻）、`EN→中`、`日→中`（辨識後經 Claude 翻繁中，原文＋譯文並排）
  - 翻譯沿用記帳 App 同網域 `localStorage` 的 `balance-cfg`（Claude Worker + 金鑰）
  - 深色模式、三段字級
- **`openai-stt-worker.js`** — OpenAI 轉錄轉發器（Cloudflare Worker），**尚未部署**。

## 目標：把 captions.html 升級成雙引擎

新增 **OpenAI 引擎**，相對 Web Speech 的三個升級：
1. **系統音真的可用**：用 `getDisplayMedia({video:true,audio:true})` 抓分頁/系統音訊，
   拿 audio track 送去轉錄——不用再靠「立體聲混音」。（Chrome 限定，使用者要勾「分享分頁音訊」）
2. **辨識更準**：`gpt-4o-mini-transcribe`（預設，快又便宜）/ `gpt-4o-transcribe`（更準）。
3. 依需要仍可經 Claude 翻成繁中（沿用現有翻譯管線）。

保留 Web Speech 為預設引擎與離線 fallback，OpenAI 為可切換的進階引擎。

## 為什麼一定要 Worker（不要從瀏覽器直連 OpenAI）

- 瀏覽器直連 `api.openai.com` 會被 **CORS 擋**，且金鑰會暴露在前端。
- 故用 `openai-stt-worker.js` 轉發：前端把金鑰放 `localStorage`、隨 multipart 欄位 `key`
  帶給 Worker，Worker 只轉發不儲存（與 Claude 轉發器同模式，金鑰不進 repo）。

### Worker 請求/回應契約（已實作於 openai-stt-worker.js）
- `POST` multipart/form-data：`file`(音檔)、`key`(sk-...)、`model`(選)、`language`(選 en/ja/zh)、`prompt`(選)
- 回傳 OpenAI 原始 JSON：`{ text }` 或 `{ error }`

## 待辦（本機 session 執行）

### 1. 讀金鑰、部署 Worker
- 讀 `C:\Users\dinef\AI\keys\即時會議字幕.txt` 取得 OpenAI 金鑰（僅本機測試用，**勿寫進 repo**）。
- 把 `openai-stt-worker.js` 貼到 Cloudflare 部署，取得 workers.dev 網址。

### 2. captions.html 加 OpenAI 引擎
- **設定 UI（⚙）**：新增 `STT Worker URL`、`OpenAI Key`、`model` 三欄，存 `localStorage` key = `cap-cfg`
  （與翻譯用的 `balance-cfg` 分開，不動記帳功能）。
- **引擎切換**：`瀏覽器(免費)` / `OpenAI(準·可系統音)`；OpenAI 時多一個**音源**切換 `麥克風` / `系統音`。
- **依靜音切句的擷取管線**（建議參數，實機再調）：
  - `getUserMedia({audio:true})` 或 `getDisplayMedia({video:true,audio:true})`（取 audio track，video track 可 stop）
  - Web Audio `AnalyserNode` 算 RMS 做 VAD；`MediaRecorder(stream,{mimeType:'audio/webm'})`
  - 講完停頓（靜音 ~700ms）就 `recorder.stop()` → `onstop` 取 Blob 送轉錄 → 重新 `start()` 下一句
  - 上限保護：單句連續 >~12s 強制切；Blob 太小(<~2KB)或太短(<~400ms)略過
  - **注意**：`MediaRecorder` 用 timeslice 切出的片段不是獨立可解碼檔，必須 stop/start 才能得到完整 webm。
- **送轉錄**：把 Blob 以 `FormData`（`file`,`key`,`model`,`language`）POST 到 STT Worker，取回 `text`。
- **翻譯**：`中文` 模式不翻；`EN→中`/`日→中` 把 `text` 丟現有 `translate()`（Claude）翻繁中。
  OpenAI 可自動偵測語言，可考慮加「自動→中」：非中文才翻（用簡單中日文字元比例判斷）。
- 逐字稿、複製、下載、保存、字級、深色沿用現有函式即可。

### 3. 實機測試（雲端做不到，務必本機驗證）
- Chrome 開頁 → OpenAI 引擎 + 麥克風：講中/英/日，確認 2~4 秒內出字、翻譯正確。
- 切「系統音」→ 選一個有聲音的分頁並勾「分享分頁音訊」→ 確認能字幕該分頁。
- 長時間（>5 分鐘）連續講話，確認切句/重啟穩定、不漏句、記憶體不爆。

## 相關 localStorage key
- `balance-cfg`：記帳 App 的 Claude Worker + 金鑰（翻譯沿用，勿改）
- `cap-cfg`：字幕頁 OpenAI 設定（STT Worker URL / OpenAI Key / model）— 待新增
- `cap-transcript` / `cap-font` / `cap-dark`：逐字稿與偏好

## 怎麼接手（給使用者的步驟）
1. 本機在 balance repo 開 Claude Code。
2. `git fetch origin && git checkout claude/github-pages-url-yc2yz0 && git pull`
3. 叫本機 Claude：「讀 HANDOFF.md,接續完成 OpenAI 引擎」。
