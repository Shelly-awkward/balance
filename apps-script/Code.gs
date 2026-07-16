/**
 * Balance 記帳後端（Google Apps Script）
 *
 * 功能：
 *  1. doGet  — 讀取全部紀錄（App「總覽/紀錄/信用卡」頁用），每列附 _row 供更新定位
 *  2. doPost — 新增一列（App「入帳」用）；action:'update' 時更新指定列的「項目」「分類」
 *  3. importRakutenEmails — 定時觸發器：讀 Gmail 樂天刷卡通知信自動入帳
 *
 * 安裝步驟見同資料夾 README.md。
 * Token 存在「專案設定 → 指令碼屬性」的 TOKEN，不要寫死在這裡。
 */

const SHEET_NAME = '';   // 留空＝用試算表的第一個工作表；有多個分頁時填工作表名稱
const HEADERS = ['日期', '項目', '金額', '付款方式', '幣別', '分類', '匯率', '台幣等值'];
const PANDA = '樂天熊貓卡(5日結帳26日繳款)';
const DONE_LABEL = '已處理-自動入帳';
const GMAIL_QUERY = 'from:info@card.rakuten.com.tw subject:信用卡刷卡交易通知 -label:' + DONE_LABEL;
const PENDING_DESC = '刷卡消費(待補)';
const PENDING_CAT = '待補';

// 店名關鍵字 → 分類（比照 App 語音解析的提示，可自行增補）
const CAT_KEYWORDS = {
  '全聯': '食材採買', '家樂福': '食材採買', '菜市場': '食材採買',
  'Kobo': '電子書', 'KOBO': '電子書',
  'foodpanda': '外食', 'Foodpanda': '外食', 'Uber Eats': '外食', '麥當勞': '外食', '摩斯': '外食',
  'YouBike': '交通', 'Uber': '交通', '台灣大車隊': '交通', '高鐵': '交通', '台鐵': '交通',
  'Claude': '軟體訂閱', 'iCloud': '軟體訂閱', 'Apple': '軟體訂閱', 'Google': '軟體訂閱', 'Netflix': '軟體訂閱',
  '博客來': '圖書', '誠品': '圖書',
  '屈臣氏': '生活用品', '寶雅': '生活用品', '康是美': '生活用品',
  '中華電信': '電信費', '台灣大哥大': '電信費', '遠傳': '電信費'
};

// ===== 共用 =====
function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}
// 讀表頭列，回傳 {欄名: 欄號(1-based)}，欄位順序被動過也不會寫錯格
function colIndex_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = {};
  head.forEach(function (h, i) { idx[String(h).trim()] = i + 1; });
  return idx;
}
function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  const s = String(v);
  let m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return s;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 讀取（App GET ?token=xxx）=====
function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.token !== getToken_()) return json_({ error: 'unauthorized' });
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return json_([]);
    const head = values[0].map(function (h) { return String(h).trim(); });
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const o = { _row: i + 1 }; // 實際工作表列號（表頭是第 1 列）
      head.forEach(function (h, c) {
        o[h] = (h === '日期') ? fmtDate_(values[i][c]) : values[i][c];
      });
      rows.push(o);
    }
    return json_(rows);
  } catch (err) {
    return json_({ error: String(err) });
  }
}

// ===== 寫入（App POST，text/plain JSON）=====
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== getToken_()) return json_({ ok: false, error: 'unauthorized' });
    if (b.action === 'update') return handleUpdate_(b);
    return handleAppend_(b); // 無 action＝新增（維持舊契約）
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function handleAppend_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const idx = colIndex_(sheet);
    const row = new Array(sheet.getLastColumn()).fill('');
    const vals = { '日期': b.date, '項目': b.description, '金額': b.amount, '付款方式': b.payment, '幣別': b.currency, '分類': b.category, '匯率': b.rate, '台幣等值': b.amountTWD };
    HEADERS.forEach(function (h) { if (idx[h]) row[idx[h] - 1] = vals[h]; });
    sheet.appendRow(row);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 只更新「項目」「分類」；先核對日期+金額，防止 App 快取過期時改錯列
function handleUpdate_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const row = Number(b.row);
    if (!row || row < 2 || row > sheet.getLastRow()) return json_({ ok: false, error: 'bad_row' });
    const idx = colIndex_(sheet);
    if (!idx['項目'] || !idx['分類'] || !idx['日期'] || !idx['金額']) return json_({ ok: false, error: 'bad_headers' });
    const curDate = fmtDate_(sheet.getRange(row, idx['日期']).getValue());
    const curAmt = Number(String(sheet.getRange(row, idx['金額']).getValue()).replace(/,/g, ''));
    if (curDate !== String(b.expectDate) || Math.abs(curAmt - Number(b.expectAmount)) > 0.001) {
      return json_({ ok: false, error: 'stale' });
    }
    sheet.getRange(row, idx['項目']).setValue(b.description);
    sheet.getRange(row, idx['分類']).setValue(b.category);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ===== Gmail 自動入帳（時間觸發器：每 15 分鐘跑 importRakutenEmails）=====
// 用 Gmail 進階服務逐「訊息」處理：同一討論串常包多封刷卡通知，
// GmailApp 的標籤是討論串層級，會漏掉後來的信，所以不用 GmailApp。
function importRakutenEmails() {
  const doneLabelId = getDoneLabelId_();
  const list = Gmail.Users.Messages.list('me', { q: GMAIL_QUERY, maxResults: 50 });
  const msgs = (list.messages || []);
  msgs.forEach(function (m) {
    try {
      importOneMessage_(m.id, doneLabelId);
    } catch (err) {
      // 單封失敗不影響其他封；沒貼標籤的下一輪會重試
      console.error('匯入失敗 message=' + m.id + ': ' + err);
    }
  });
}

function getDoneLabelId_() {
  const labels = Gmail.Users.Labels.list('me').labels || [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].name === DONE_LABEL) return labels[i].id;
  }
  return Gmail.Users.Labels.create({ name: DONE_LABEL }, 'me').id;
}

function importOneMessage_(msgId, doneLabelId) {
  const msg = Gmail.Users.Messages.get('me', msgId, { format: 'full' });
  if ((msg.labelIds || []).indexOf(doneLabelId) !== -1) return; // 已處理過
  const text = extractText_(msg.payload);
  const parsed = parseRakutenMail_(text);
  if (!parsed) {
    console.warn('解析不到日期/金額，略過（不貼標籤，下輪重試）message=' + msgId);
    return;
  }
  const desc = parsed.merchant ? parsed.merchant : PENDING_DESC;
  const cat = parsed.merchant ? matchCategory_(parsed.merchant) : PENDING_CAT;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const idx = colIndex_(sheet);
    const row = new Array(sheet.getLastColumn()).fill('');
    const vals = { '日期': parsed.date, '項目': desc, '金額': parsed.amount, '付款方式': PANDA, '幣別': '新台幣', '分類': cat, '匯率': 1, '台幣等值': parsed.amount };
    HEADERS.forEach(function (h) { if (idx[h]) row[idx[h] - 1] = vals[h]; });
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  // 成功寫入後才貼標籤，避免寫入失敗卻被標成已處理
  Gmail.Users.Messages.modify({ addLabelIds: [doneLabelId] }, 'me', msgId);
}

// 從 message payload 取出內文（優先 text/html，退回 text/plain）
function extractText_(payload) {
  const html = findPart_(payload, 'text/html') || findPart_(payload, 'text/plain') || '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|font|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}
function findPart_(part, mime) {
  if (!part) return '';
  if (part.mimeType === mime && part.body && part.body.data) {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(part.body.data)).getDataAsString('UTF-8');
  }
  const parts = part.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const found = findPart_(parts[i], mime);
    if (found) return found;
  }
  return '';
}

/**
 * 解析樂天刷卡通知信內文，格式（2026-07 實際信件確認）：
 *   115/07/11 10:33      ← 民國年
 *   在藍新                ← 商店名，「在」後面經常是空的
 *   約NT 1 元
 * 回傳 {date:'yyyy-MM-dd', merchant:'', amount:Number}；抓不到日期或金額回 null
 */
function parseRakutenMail_(text) {
  const dm = text.match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}/);
  const am = text.match(/約NT\s*([\d,]+)\s*元/);
  if (!dm || !am) return null;
  const y = Number(dm[1]) + 1911; // 民國 → 西元
  const date = y + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[3]).slice(-2);
  const amount = Number(am[1].replace(/,/g, ''));
  if (!amount) return null;
  let merchant = '';
  const mm = text.match(/^\s*在(.*)$/m);
  if (mm) merchant = mm[1].trim();
  return { date: date, merchant: merchant, amount: amount };
}

function matchCategory_(merchant) {
  for (const kw in CAT_KEYWORDS) {
    if (merchant.indexOf(kw) !== -1) return CAT_KEYWORDS[kw];
  }
  return PENDING_CAT; // 對不到就標待補，App 紀錄頁會提示補分類
}
