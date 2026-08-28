'use strict';
// 結果式付費的付費邊界測試。
// 這支的重點只有一個：完整報告在付款之前，絕對不能離開伺服器。
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token';
// 用暫存目錄，測試不寫進 repo
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-paywall-'));

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_TOKEN },
  stdio: ['ignore', 'pipe', 'pipe']
});

function req(method, url, body, headers) {
  return fetch(BASE + url, {
    method,
    headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers || {}),
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('結果式付費：完整報告只有付款後才拿得到', async (t) => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { child.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

  // 1. 建案件（免費）
  const created = await req('POST', '/api/case', { result: 'soft' });
  assert.strictEqual(created.status, 200);
  const { orderId, token } = created.json;
  assert.match(orderId, /^KC\d{17}$/);
  assert.strictEqual(typeof token, 'string');
  assert.strictEqual(token.length, 32, 'token 應為 32 字元 hex');

  // 2. 初始狀態 open
  const opened = await req('GET', `/api/order/${orderId}`);
  assert.strictEqual(opened.json.status, 'open');

  // 3. 沒帶 token 不能送問卷
  const noToken = await req('POST', '/api/delivery', { orderId, answers: {}, contact: 'line:ken' });
  assert.strictEqual(noToken.status, 403);

  // 4. 沒留聯絡方式不能送（付款前流程要靠它通知）
  const q = await req('GET', '/api/questionnaire');
  const answers = {};
  q.json.questions.forEach((x) => { answers[x.id] = x.options[0]; });
  const noContact = await req('POST', '/api/delivery', { orderId, token, answers });
  assert.strictEqual(noContact.status, 400);

  // 5. 問卷送出（付款前就能送，這是結果式付費的重點）
  const deliv = await req('POST', '/api/delivery', { orderId, token, answers, contact: 'line:ken' });
  assert.strictEqual(deliv.status, 200);
  assert.strictEqual(deliv.json.status, 'open', '只有問卷、還沒照片時仍是 open');

  // 6. 照片送出 → 收齊，轉 submitted
  const up = await req('POST', '/api/upload-photo', { orderId, token, photo: TINY_PNG });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.status, 'submitted');
  assert.ok(up.json.photo.includes(token.slice(0, 16)), '照片檔名要帶 token，避免被猜到');

  // 7. 報告還沒好 → 不能付款
  const tooEarly = await req('POST', '/api/order', { orderId, token });
  assert.strictEqual(tooEarly.status, 409, '預覽出來之前不開放付款');

  // 8. admin 端點要 token
  const noAdmin = await req('POST', '/api/admin/report', { orderId, preview: 'p', full: 'f' });
  assert.strictEqual(noAdmin.status, 403);

  // 9. Ken 交報告
  const put = await req('POST', '/api/admin/report',
    { orderId, preview: '預覽段落', full: '完整報告內容' },
    { 'x-admin-token': ADMIN_TOKEN });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(put.json.status, 'preview_ready');

  // 10. 查報告要 token
  const repNoToken = await req('GET', `/api/report?order=${orderId}`);
  assert.strictEqual(repNoToken.status, 403);

  // 11. ★ 未付款：拿得到預覽，拿不到完整報告
  const unpaid = await req('GET', `/api/report?order=${orderId}&t=${token}`);
  assert.strictEqual(unpaid.status, 200);
  assert.strictEqual(unpaid.json.status, 'preview_ready');
  assert.strictEqual(unpaid.json.preview, '預覽段落');
  assert.ok(!('full' in unpaid.json), '未付款時回應不得帶 full 欄位');
  assert.ok(!JSON.stringify(unpaid.json).includes('完整報告內容'), '完整報告內容不得出現在未付款的回應裡');

  // 12. 付款
  const pay = await req('POST', '/api/demo-pay', { orderId, token });
  assert.strictEqual(pay.status, 200);

  // 13. ★ 付款後：完整報告解鎖
  const paid = await req('GET', `/api/report?order=${orderId}&t=${token}`);
  assert.strictEqual(paid.json.status, 'paid');
  assert.strictEqual(paid.json.full, '完整報告內容');

  // 14. 別的案件的 token 不能拿來讀這一件
  const other = await req('POST', '/api/case', { result: 'hard' });
  const cross = await req('GET', `/api/report?order=${orderId}&t=${other.json.token}`);
  assert.strictEqual(cross.status, 403, '不得用別的案件的 token 讀取');
});

test('後台端點：沒有 ADMIN_TOKEN 一律擋掉', async (t) => {
  const P2 = 3900 + Math.floor(Math.random() * 300);
  const B2 = `http://127.0.0.1:${P2}`;
  const D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-admin-'));
  const c2 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(P2), DATA_DIR: D2, ADMIN_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B2 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c2.kill(); fs.rmSync(D2, { recursive: true, force: true }); });

  const call = (url, tok) => fetch(B2 + url, { headers: tok ? { 'x-admin-token': tok } : {} })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  // 建一件有內容的案件
  const made = await fetch(B2 + '/api/case', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: 'soft' })
  }).then((r) => r.json());

  // 沒 token / 錯 token 都不行
  assert.strictEqual((await call('/api/admin/cases')).status, 403);
  assert.strictEqual((await call('/api/admin/cases', 'wrong-token')).status, 403);
  assert.strictEqual((await call(`/api/admin/case/${made.orderId}`)).status, 403);
  assert.strictEqual((await call(`/api/admin/case/${made.orderId}`, 'wrong-token')).status, 403);

  // 對的 token 拿得到佇列
  const q = await call('/api/admin/cases', ADMIN_TOKEN);
  assert.strictEqual(q.status, 200);
  assert.ok(Array.isArray(q.json.cases));
  assert.ok(q.json.cases.some((c) => c.id === made.orderId), '新案件應該出現在待處理佇列');

  // 明細帶得出報告連結（含 token），Ken 才貼得給對方
  const d = await call(`/api/admin/case/${made.orderId}`, ADMIN_TOKEN);
  assert.strictEqual(d.status, 200);
  assert.ok(d.json.reportUrl.includes(made.orderId));
  assert.ok(d.json.reportUrl.includes(made.token));

  // 佇列摘要不得夾帶存取碼（那是給客戶的，不該在列表裡外流）
  const listed = q.json.cases.find((c) => c.id === made.orderId);
  assert.ok(!('token' in listed), '佇列摘要不得包含 token');
});
