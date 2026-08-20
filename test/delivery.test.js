'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
const started = new Promise((resolve, reject) => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
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

  // 1. 建立訂單（模擬模式）
  const order = await req('POST', '/api/order', { result: '太軟' });
  assert.strictEqual(order.status, 200);
  assert.strictEqual(order.json.demo, true);
  const orderId = order.json.orderId;

  // 2. 尚未付款，送出問卷應拒絕
  const pre = await req('POST', '/api/delivery', { orderId, answers: {} });
  assert.strictEqual(pre.status, 400);

  // 3. 模擬付款
  const pay = await req('POST', '/api/demo-pay', { orderId });
  assert.strictEqual(pay.json.ok, true);

  // 4. 取得問卷定義
  const q = await req('GET', '/api/questionnaire');
  assert.strictEqual(q.status, 200);
  assert.strictEqual(q.json.questions.length, 7);

  // 5. 送出完整問卷
  const answers = {};
  q.json.questions.forEach((x, i) => { answers[x.id] = x.options[0]; });
  const deliv = await req('POST', '/api/delivery', { orderId, answers });
  assert.strictEqual(deliv.status, 200);
  assert.strictEqual(deliv.json.ok, true);

  // 6. 送出缺題問卷應失敗
  const incomplete = { q1: 'x' };
  const bad = await req('POST', '/api/delivery', { orderId, answers: incomplete });
  assert.strictEqual(bad.status, 400);

  // 7. 上傳照片（1x1 紅點 PNG data URL）
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await req('POST', '/api/upload-photo', { orderId, photo: tinyPng });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.ok, true);
  assert.ok(up.json.photo.startsWith('/uploads/'));

  // 8. 查詢報告資料齊全
  const rep = await req('GET', `/api/report?order=${orderId}`);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.json.status, 'paid');
  assert.ok(rep.json.answers);
  assert.ok(rep.json.photo);
  assert.strictEqual(rep.json.reportReady, true);
});
