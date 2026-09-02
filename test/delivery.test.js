'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

// 用獨立 DATA_DIR 隔離測試資料，並預置一筆「token 上線前」的舊訂單
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-delivery-'));
const LEGACY_ID = 'KC20260101000000123';
fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify({
  [LEGACY_ID]: { id: LEGACY_ID, result: '舊單', amount: 499, status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }
}));

let child;
const started = new Promise((resolve, reject) => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.includes('server on')) resolve(); });
  child.stderr.on('data', () => {});
  setTimeout(() => reject(new Error('server start timeout')), 5000);
});

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let json = null; try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, json, raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('server 啟動（交付端點整合流程）', async (t) => {
  await started;
  t.after(() => child.kill());

  // 1. 建立訂單（模擬模式），帶完整董事會資料
  const order = await req('POST', '/api/order', {
    result: '太軟',
    board: { top: [{ key: 'taiyin', role: '內務總管' }, { key: 'wuqu', role: '執行長' }], bars: { B1: 40, B2: 60, B3: 50, B4: 30 } }
  });
  assert.strictEqual(order.status, 200);
  assert.strictEqual(order.json.demo, true);
  const orderId = order.json.orderId;
  const token = order.json.token;

  // 1a. 舊訂單（token 上線前）維持以 orderId 為憑證，可查詢、可模擬付款
  const legacy = await req('GET', `/api/order/${LEGACY_ID}`);
  assert.strictEqual(legacy.status, 200, '舊訂單不需 token 即可查詢');
  assert.strictEqual(legacy.json.status, 'pending');
  const legacyPay = await req('POST', '/api/demo-pay', { orderId: LEGACY_ID });
  assert.strictEqual(legacyPay.json.ok, true, '舊訂單不需 token 即可完成既有流程');

  // 2. 尚未付款，送出問卷應拒絕（帶正確 token）
  const pre = await req('POST', '/api/delivery', { orderId, token, answers: {} });
  assert.strictEqual(pre.status, 400);

  // 2a. 錯 token 的問卷視為不存在（防列舉）
  const evil = await req('POST', '/api/delivery', { orderId, token: 'nope', answers: {} });
  assert.strictEqual(evil.status, 404);

  // 3. 模擬付款
  const pay = await req('POST', '/api/demo-pay', { orderId, token });
  assert.strictEqual(pay.json.ok, true);

  // 3a. DEMO 模式下錯 token 無法偷付款
  const evilPay = await req('POST', '/api/demo-pay', { orderId, token: 'nope' });
  assert.strictEqual(evilPay.status, 404);

  // 4. 取得問卷定義
  const q = await req('GET', '/api/questionnaire');
  assert.strictEqual(q.status, 200);
  assert.strictEqual(q.json.questions.length, 7);

  // 5. 送出完整問卷
  const answers = {};
  q.json.questions.forEach((x, i) => { answers[x.id] = x.options[0]; });
  const deliv = await req('POST', '/api/delivery', { orderId, token, answers });
  assert.strictEqual(deliv.status, 200);
  assert.strictEqual(deliv.json.ok, true);

  // 6. 送出缺題問卷應失敗
  const incomplete = { q1: 'x' };
  const bad = await req('POST', '/api/delivery', { orderId, token, answers: incomplete });
  assert.strictEqual(bad.status, 400);

  // 7. 上傳照片（1x1 紅點 PNG data URL）
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await req('POST', '/api/upload-photo', { orderId, token, photo: tinyPng });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.ok, true);
  assert.ok(up.json.photo.startsWith('/uploads/'));

  // 8. 查詢報告資料齊全（需帶 token）
  const repNoTok = await req('GET', `/api/report?order=${orderId}`);
  assert.strictEqual(repNoTok.status, 404, '無 token 不得讀取報告資料');
  const rep = await req('GET', `/api/report?order=${orderId}&token=${token}`);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.json.status, 'paid');
  assert.ok(rep.json.answers);
  assert.ok(rep.json.photo);
  assert.strictEqual(rep.json.reportReady, true);
  // 董事會資料隨訂單帶入報告流程
  assert.strictEqual(rep.json.board.top[0].key, 'taiyin');
  assert.strictEqual(rep.json.board.bars.B2, 60);
});
