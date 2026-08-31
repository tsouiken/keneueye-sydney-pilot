'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

// 在隨機埠啟動伺服器（模擬付款模式：不設綠界憑證）
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), BASE_URL: BASE },
  stdio: ['ignore', 'pipe', 'pipe']
});

function req(method, url, body) {
  return fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

test('API 完整流程（模擬付款模式）', async (t) => {
  // 等伺服器起來
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/health'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }

  t.after(() => child.kill());

  // 1. 健康檢查
  const health = await req('GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.json.demo, true, '未設綠界憑證應為模擬模式');
  assert.strictEqual(health.json.price, 499);

  // 2. 建立訂單 → 模擬模式回傳 orderId
  const order = await req('POST', '/api/order', { result: 'soft' });
  assert.strictEqual(order.status, 200);
  assert.strictEqual(order.json.demo, true);
  const orderId = order.json.orderId;
  assert.match(orderId, /^KC\d{17}$/, '訂單編號格式 KC + 17 位數字');

  // 3. 訂單初始為 pending
  const pending = await req('GET', `/api/order/${orderId}`);
  assert.strictEqual(pending.json.status, 'pending');
  assert.strictEqual(pending.json.amount, 499);
  assert.strictEqual(pending.json.result, 'soft');

  // 4. 模擬付款成功
  const pay = await req('POST', '/api/demo-pay', { orderId });
  assert.strictEqual(pay.status, 200);
  assert.strictEqual(pay.json.ok, true);

  // 5. 訂單轉為 paid
  const paid = await req('GET', `/api/order/${orderId}`);
  assert.strictEqual(paid.json.status, 'paid');

  // 6. 不存在的訂單 → 404
  const missing = await req('GET', '/api/order/KC00000000000000000');
  assert.strictEqual(missing.status, 404);

  // 7. 靜態頁面可存取
  const quiz = await fetch(BASE + '/quiz/');
  assert.strictEqual(quiz.status, 200);
  assert.ok((await quiz.text()).includes('董事會遊戲'));

  const checkout = await fetch(BASE + '/quiz/checkout.html');
  assert.strictEqual(checkout.status, 200);

  const logic = await fetch(BASE + '/quiz/quiz-logic.js');
  assert.strictEqual(logic.status, 200);

  const data = await fetch(BASE + '/quiz/quiz-data.js');
  assert.strictEqual(data.status, 200);

  // 8. 路徑穿越防護：URL 正規化後，任何嘗試都讀不到 ROOT 以外的檔案
  const evil = await new Promise((resolve, reject) => {
    const net = require('node:net');
    const sock = net.connect(PORT, 'localhost', () => {
      sock.write('GET /../../../../etc/passwd HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    sock.on('data', (c) => { data += c; });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
  assert.match(evil, /^HTTP\/1\.1 404/, '穿越嘗試不得讀到 ROOT 以外的檔案');
});
