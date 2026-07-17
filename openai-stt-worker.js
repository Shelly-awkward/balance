/**
 * OpenAI 語音轉錄轉發器（Cloudflare Worker）
 * ------------------------------------------------------------
 * 用途：讓 captions.html 從瀏覽器把音訊送去 OpenAI 轉錄，
 *       同時解決 (1) CORS 擋瀏覽器直連 (2) 金鑰不暴露在前端程式碼。
 *
 * 部署：
 *   1. 到 dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. 把這整支貼上去、Deploy，取得網址（https://xxx.workers.dev）
 *   3. 把該網址填進 captions.html 的 ⚙ 設定「STT Worker URL」
 *
 * 金鑰處理：前端把 OpenAI 金鑰放在瀏覽器 localStorage，隨每次請求
 *   以 multipart 欄位 `key` 帶進來，本 Worker 只負責轉發、不儲存。
 *   （與記帳 App 的 Claude 轉發器相同模式，金鑰不進 repo）
 *
 * 請求（multipart/form-data）：
 *   file     必填  音檔（webm/opus 等 OpenAI 支援格式）
 *   key      必填  OpenAI API 金鑰（sk-...）
 *   model    選填  預設 gpt-4o-mini-transcribe
 *   language 選填  語言提示（en / ja / zh…），留空＝自動偵測
 *   prompt   選填  提高專有名詞辨識用的前文提示
 * 回應：直接回傳 OpenAI 的 JSON（{ text } 或 { error }）
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    try {
      const form = await req.formData();
      const key = form.get('key');
      const file = form.get('file');
      const model = form.get('model') || 'gpt-4o-mini-transcribe';
      const language = form.get('language') || '';
      const prompt = form.get('prompt') || '';
      if (!key || !file) return json({ error: '缺少 key 或 file' }, 400);

      const out = new FormData();
      // 保留原始檔名（OpenAI 靠副檔名判斷格式），沒有才 fallback webm
      out.append('file', file, (file.name && file.name.includes('.')) ? file.name : 'audio.webm');
      out.append('model', model);
      out.append('response_format', 'json');
      if (language) out.append('language', language);
      if (prompt) out.append('prompt', prompt);

      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key },
        body: out,
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
