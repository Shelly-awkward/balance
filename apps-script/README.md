# Apps Script 後端安裝說明

`Code.gs` 是記帳 App 的完整後端：讀取／新增紀錄、**更新已入帳紀錄的「項目」「分類」**（App 紀錄頁點列編輯用），以及 **Gmail 樂天刷卡通知自動入帳**。

## 安裝／更新步驟

1. 開啟記帳的 Google Sheet → 「擴充功能」→「Apps Script」。
2. **先把舊程式碼複製備份**（貼到隨便一個文件存起來），然後把 `Code.gs` 整份貼上取代。
3. 左側「專案設定」（齒輪）→「指令碼屬性」→ 新增屬性：
   - 名稱：`TOKEN`
   - 值：與 App「⚙️ 設定」頁的「驗證密碼 (Token)」相同。
4. 左側「服務」旁的「＋」→ 找到 **Gmail API** → 新增（Gmail 匯入用的進階服務）。
5. 「部署」→「管理部署」→ 鉛筆「編輯」→ 版本選「**新版本**」→「部署」。
   - ⚠️ 每次改完程式碼都要重新部署新版本才會生效，只按儲存沒有用。
   - 第一次部署選「新增部署」→ 類型「網頁應用程式」→ 執行身分「我」、存取權「任何人」，把網址填入 App 設定頁的「Google Apps Script URL」。
6. 在編輯器上方選 `importRakutenEmails` → 按「執行」跑一次，完成 Gmail／試算表授權；順便確認沒有錯誤。
7. 左側「觸發條件」（鬧鐘）→ 確認有一個 `importRakutenEmails`、「時間驅動」、「每 15 分鐘」的觸發器；沒有就新增一個。

## 運作方式

### Gmail 自動入帳（importRakutenEmails）

- 搜尋 `info@card.rakuten.com.tw` 寄來、主旨「信用卡刷卡交易通知」、還沒貼「已處理-自動入帳」標籤的信。
- 逐**封**處理（同一討論串常有多封通知，不會漏）：解析民國日期、商店名、金額。
- 商店名有抓到 → 項目＝商店名，並用關鍵字對照表猜分類（`CAT_KEYWORDS`，可自行增補）。
- 商店名是空的（樂天即時通知經常如此）→ 項目寫「**刷卡消費(待補)**」、分類「**待補**」，之後在 App 紀錄頁點該筆補上即可。
- **成功寫入試算表後**才貼標籤；解析失敗的信不貼標籤，下一輪自動重試。

### API 契約（App 前端依賴，改動請小心）

- 試算表欄位（第 1 列表頭，順序可換但名稱要在）：`日期、項目、金額、付款方式、幣別、分類、匯率、台幣等值`
- `GET ?token=xxx` → 全部紀錄的 JSON 陣列，每列多帶 `_row`（實際列號，前端更新用）。
- `POST`（text/plain JSON）：
  - 無 `action` → 新增一列：`{token, date, description, amount, payment, currency, category, rate, amountTWD}`
  - `action:'update'` → 更新項目/分類：`{token, action:'update', row, expectDate, expectAmount, description, category}`；後端會核對該列的日期＋金額，不符回 `{ok:false,error:'stale'}`（防止 App 資料過期改錯列）。
