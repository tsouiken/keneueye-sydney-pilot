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

test('跑單防護：同一個聯絡方式不能無限排隊未付款案件', async (t) => {
  const P3 = 4200 + Math.floor(Math.random() * 300);
  const B3 = `http://127.0.0.1:${P3}`;
  const D3 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-ratelimit-'));
  const c3 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    // 上限設 2：第三件同聯絡方式的未付款案件應被擋下
    env: { ...process.env, PORT: String(P3), DATA_DIR: D3, ADMIN_TOKEN, MAX_OPEN_PER_CONTACT: '2' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B3 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c3.kill(); fs.rmSync(D3, { recursive: true, force: true }); });

  const post = (url, body, headers) => fetch(B3 + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const qs = await fetch(B3 + '/api/questionnaire').then((r) => r.json());
  const answers = {};
  qs.questions.forEach((x) => { answers[x.id] = x.options[0]; });

  async function submit(contact) {
    const c = await post('/api/case', { result: 'soft' });
    const r = await post('/api/delivery', {
      orderId: c.json.orderId, token: c.json.token, answers, contact
    });
    return { caseInfo: c.json, res: r };
  }

  const a = await submit('line:same-person');
  assert.strictEqual(a.res.status, 200);
  const b = await submit('LINE:Same-Person');   // 大小寫不同視為同一人
  assert.strictEqual(b.res.status, 200);

  const third = await submit('line:  same-person  '); // 夾空白也視為同一人
  assert.strictEqual(third.res.status, 429, '超過上限應被擋下');

  // 別人不受影響
  const other = await submit('line:someone-else');
  assert.strictEqual(other.res.status, 200);

  // 前面那件付款之後，名額釋出
  await post('/api/demo-pay', { orderId: a.caseInfo.orderId, token: a.caseInfo.token });
  const afterPaid = await submit('line:same-person');
  assert.strictEqual(afterPaid.res.status, 200, '已付款的案件不該再佔用名額');
});

test('舊資料遷移：結果式付費之前的訂單不能被 token 檢查鎖在門外', async (t) => {
  const P4 = 4500 + Math.floor(Math.random() * 300);
  const B4 = `http://127.0.0.1:${P4}`;
  const D4 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-legacy-'));

  // 用舊 schema 寫一份 orders.json：沒有 token，狀態是舊的 pending / paid
  fs.writeFileSync(path.join(D4, 'orders.json'), JSON.stringify({
    KC20260101000000001: {
      id: 'KC20260101000000001', result: 'soft', amount: 499,
      status: 'paid', createdAt: '2026-01-01T00:00:00.000Z'
    },
    KC20260101000000002: {
      id: 'KC20260101000000002', result: 'hard', amount: 499,
      status: 'pending', createdAt: '2026-01-01T00:00:00.000Z'
    }
  }, null, 2));

  const c4 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(P4), DATA_DIR: D4, ADMIN_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B4 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c4.kill(); fs.rmSync(D4, { recursive: true, force: true }); });

  const admin = (url) => fetch(B4 + url, { headers: { 'x-admin-token': ADMIN_TOKEN } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  // 舊的 pending 應該被對應到新流程的 open
  const migrated = await fetch(B4 + '/api/order/KC20260101000000002').then((r) => r.json());
  assert.strictEqual(migrated.status, 'open', '舊 pending 應遷移成 open');

  // 已付款的舊訂單狀態不該被動到
  const paidLegacy = await fetch(B4 + '/api/order/KC20260101000000001').then((r) => r.json());
  assert.strictEqual(paidLegacy.status, 'paid', '舊的已付款訂單不該被改狀態');

  // 兩筆都要補到 token —— 從後台明細拿得到，且不是 undefined
  const detail = await admin('/api/admin/case/KC20260101000000001');
  assert.strictEqual(detail.status, 200);
  assert.ok(!detail.json.reportUrl.includes('t=undefined'), '報告連結不得是 t=undefined');
  const tok = new URL('http://x' + detail.json.reportUrl).searchParams.get('t');
  assert.strictEqual(typeof tok, 'string');
  assert.strictEqual(tok.length, 32, '遷移補的 token 應為 32 字元');

  // 拿補好的 token 應該真的讀得到報告（已付款客戶不能被鎖在門外）
  const rep = await fetch(`${B4}/api/report?order=KC20260101000000001&t=${tok}`)
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  assert.strictEqual(rep.status, 200, '已付款的舊客戶必須讀得到自己的報告');
  assert.strictEqual(rep.json.status, 'paid');

  // 遷移結果要落地，不能只存在記憶體
  const onDisk = JSON.parse(fs.readFileSync(path.join(D4, 'orders.json'), 'utf8'));
  assert.strictEqual(onDisk.KC20260101000000001.token, tok, '補的 token 要寫回檔案');
  assert.strictEqual(onDisk.KC20260101000000002.status, 'open');
});

test('真實金流：綠界導回的網址要帶 token，否則付完錢打不開報告', async (t) => {
  const P5 = 4800 + Math.floor(Math.random() * 300);
  const B5 = `http://127.0.0.1:${P5}`;
  const D5 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-ecpay-'));
  // 填入綠界官方測試憑證 → 離開模擬模式，才會產生 ClientBackURL
  const c5 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(P5), DATA_DIR: D5, ADMIN_TOKEN,
      BASE_URL: 'https://example.com',
      ECPAY_MERCHANT_ID: '2000132',
      ECPAY_HASH_KEY: '5294y06JbISpM5x9',
      ECPAY_HASH_IV: 'v77hoKGq4kWxNNIS'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B5 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c5.kill(); fs.rmSync(D5, { recursive: true, force: true }); });

  const post = (url, body, headers) => fetch(B5 + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const health = await fetch(B5 + '/api/health').then((r) => r.json());
  assert.strictEqual(health.demo, false, '有憑證就不該是模擬模式');

  const c = await post('/api/case', { result: 'soft' });
  await post('/api/admin/report',
    { orderId: c.json.orderId, preview: 'p', full: 'f' },
    { 'x-admin-token': ADMIN_TOKEN });

  const order = await post('/api/order', { orderId: c.json.orderId, token: c.json.token });
  assert.strictEqual(order.status, 200);
  const backUrl = order.json.formFields.ClientBackURL;
  assert.ok(backUrl.includes('order=' + c.json.orderId), '導回網址要帶案件編號');
  assert.ok(backUrl.includes('t=' + c.json.token), '導回網址要帶 token，不然付完錢開不了報告');
});

test('舊的已付款案件還沒有報告時，不能當成已交付', async (t) => {
  const P6 = 5100 + Math.floor(Math.random() * 300);
  const B6 = `http://127.0.0.1:${P6}`;
  const D6 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-paidnorep-'));
  fs.writeFileSync(path.join(D6, 'orders.json'), JSON.stringify({
    KC20260101000000009: {
      id: 'KC20260101000000009', result: 'soft', amount: 499,
      status: 'paid', contact: 'line:old-customer',
      answers: { q1: 'a' }, photo: '/uploads/x.png',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  }, null, 2));
  const c6 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(P6), DATA_DIR: D6, ADMIN_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B6 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c6.kill(); fs.rmSync(D6, { recursive: true, force: true }); });

  const admin = (url) => fetch(B6 + url, { headers: { 'x-admin-token': ADMIN_TOKEN } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  // 已付款但沒有報告 → 必須出現在待辦佇列，否則沒人知道還欠他一份
  const q = await admin('/api/admin/cases');
  assert.ok(q.json.cases.some((c) => c.id === 'KC20260101000000009'),
    '已付款但還沒交報告的案件要留在待辦佇列');

  // 報告端點不該假裝已交付
  const d = await admin('/api/admin/case/KC20260101000000009');
  const tok = new URL('http://x' + d.json.reportUrl).searchParams.get('t');
  const rep = await fetch(`${B6}/api/report?order=KC20260101000000009&t=${tok}`).then((r) => r.json());
  assert.strictEqual(rep.status, 'paid');
  assert.strictEqual(rep.full, null, '沒寫報告就不該有 full 內容');
  assert.strictEqual(rep.previewReady, false);

  // 交了報告之後就從待辦佇列消失
  await fetch(B6 + '/api/admin/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ orderId: 'KC20260101000000009', preview: 'p', full: 'f' })
  });
  const q2 = await admin('/api/admin/cases');
  assert.ok(!q2.json.cases.some((c) => c.id === 'KC20260101000000009'),
    '交了報告之後就不該再留在待辦佇列');
});

test('付款重試：每次嘗試的綠界交易編號要不同，且回傳仍對應得回案件', async (t) => {
  const ecpay = require('../lib/ecpay.js');
  const KEY = '5294y06JbISpM5x9';
  const IV = 'v77hoKGq4kWxNNIS';
  const P7 = 5400 + Math.floor(Math.random() * 300);
  const B7 = `http://127.0.0.1:${P7}`;
  const D7 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-retry-'));
  const c7 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(P7), DATA_DIR: D7, ADMIN_TOKEN,
      BASE_URL: 'https://example.com',
      ECPAY_MERCHANT_ID: '2000132', ECPAY_HASH_KEY: KEY, ECPAY_HASH_IV: IV
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B7 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c7.kill(); fs.rmSync(D7, { recursive: true, force: true }); });

  const post = (url, body, headers) => fetch(B7 + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const c = await post('/api/case', { result: 'soft' });
  await post('/api/admin/report', { orderId: c.json.orderId, preview: 'p', full: 'f' },
    { 'x-admin-token': ADMIN_TOKEN });

  // 第一次嘗試 → 取消 → 第二次嘗試
  const a1 = await post('/api/order', { orderId: c.json.orderId, token: c.json.token });
  const a2 = await post('/api/order', { orderId: c.json.orderId, token: c.json.token });
  const no1 = a1.json.formFields.MerchantTradeNo;
  const no2 = a2.json.formFields.MerchantTradeNo;
  assert.notStrictEqual(no1, no2, '重試時交易編號不能重複，否則綠界會擋成重複訂單');
  assert.notStrictEqual(no1, c.json.orderId, '交易編號不該直接用案件編號');

  // 用第二次的交易編號回傳付款成功 → 仍要對應回同一個案件
  const cb = {
    MerchantID: '2000132', MerchantTradeNo: no2, RtnCode: '1', RtnMsg: 'Succeeded',
    TradeNo: '2026010100000001', TradeAmt: '499', TotalAmount: '499',
    PaymentDate: '2026/01/01 00:00:00', PaymentType: 'Credit_CreditCard', TradeDate: '2026/01/01 00:00:00'
  };
  cb.CheckMacValue = ecpay.checkMacValue(cb, KEY, IV, 'sha256');
  const cbRes = await fetch(B7 + '/api/pay-callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cb).toString()
  }).then((r) => r.text());
  assert.strictEqual(cbRes, '1|OK', '綠界回傳應被接受');

  const after = await fetch(`${B7}/api/order/${c.json.orderId}`).then((r) => r.json());
  assert.strictEqual(after.status, 'paid', '第二次嘗試的回傳要能把案件標成已付款');
});

test('LINE 設定好時，送出問卷不能因為通知失敗而 500', async (t) => {
  const P8 = 5700 + Math.floor(Math.random() * 300);
  const B8 = `http://127.0.0.1:${P8}`;
  const D8 = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-line-'));
  const c8 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    // 設了 LINE 就會走 sendLine；用 http.request 打 https 會同步拋錯而讓整個請求 500
    env: {
      ...process.env, PORT: String(P8), DATA_DIR: D8, ADMIN_TOKEN,
      LINE_ACCESS_TOKEN: 'dummy-token', LINE_OWNER_ID: 'U0000000000000000000000000000000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(B8 + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  t.after(() => { c8.kill(); fs.rmSync(D8, { recursive: true, force: true }); });

  const post = (url, body) => fetch(B8 + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const c = await post('/api/case', { result: 'soft' });
  const qs = await fetch(B8 + '/api/questionnaire').then((r) => r.json());
  const answers = {};
  qs.questions.forEach((x) => { answers[x.id] = x.options[0]; });

  await post('/api/delivery', { orderId: c.json.orderId, token: c.json.token, answers, contact: 'line:ken' });
  // 第二步收齊會觸發 sendLine —— 這一步以前會 500 而且不存檔
  const up = await post('/api/upload-photo', { orderId: c.json.orderId, token: c.json.token, photo: TINY_PNG });
  assert.strictEqual(up.status, 200, 'LINE 通知不該讓上傳失敗');
  assert.strictEqual(up.json.status, 'submitted');

  // 而且要真的存進檔案，不能因為丟例外就跳過 saveOrders
  const onDisk = JSON.parse(fs.readFileSync(path.join(D8, 'orders.json'), 'utf8'));
  assert.strictEqual(onDisk[c.json.orderId].status, 'submitted', '狀態要落地');
  assert.ok(onDisk[c.json.orderId].photo, '照片路徑要落地');
});
