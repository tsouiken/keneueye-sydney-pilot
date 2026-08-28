'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-delivery-'));

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

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
  t.after(() => { child.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

  // 1. 建立案件（免費）
  const created = await req('POST', '/api/case', { result: '太軟' });
  assert.strictEqual(created.status, 200);
  const orderId = created.json.orderId;
  const token = created.json.token;

  // 2. 存取碼不對應拒絕
  const badToken = await req('POST', '/api/delivery', { orderId, token: 'x'.repeat(32), answers: {}, contact: 'line:ken' });
  assert.strictEqual(badToken.status, 403);

  // 4. 取得問卷定義
  const q = await req('GET', '/api/questionnaire');
  assert.strictEqual(q.status, 200);
  assert.strictEqual(q.json.questions.length, 7);

  // 5. 送出完整問卷
  const answers = {};
  q.json.questions.forEach((x, i) => { answers[x.id] = x.options[0]; });
  // 結果式付費：問卷在付款「之前」就能送
  const deliv = await req('POST', '/api/delivery', { orderId, token, answers, contact: 'line:ken' });
  assert.strictEqual(deliv.status, 200);
  assert.strictEqual(deliv.json.ok, true);

  // 6. 送出缺題問卷應失敗
  const incomplete = { q1: 'x' };
  const bad = await req('POST', '/api/delivery', { orderId, token, answers: incomplete, contact: 'line:ken' });
  assert.strictEqual(bad.status, 400);

  // 7. 上傳照片（1x1 紅點 PNG data URL）
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await req('POST', '/api/upload-photo', { orderId, token, photo: tinyPng });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.ok, true);
  assert.ok(up.json.photo.startsWith('/uploads/'));

  // 8. 資料收齊 → 轉入待分析
  const rep = await req('GET', `/api/report?order=${orderId}&t=${token}`);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.json.status, 'submitted');
  assert.ok(rep.json.answers);
  assert.ok(rep.json.photo);
  assert.strictEqual(rep.json.previewReady, false, '報告還沒寫，不該有預覽');
  assert.ok(!('full' in rep.json), '未付款不得帶 full');
});
