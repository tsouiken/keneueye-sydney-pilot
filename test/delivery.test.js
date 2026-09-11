'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// 用獨立 DATA_DIR 隔離測試資料，並預置一筆「token 上線前」的舊訂單
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-delivery-'));
const LEGACY_ID = 'KC20260101000000123';
fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify({
  [LEGACY_ID]: { id: LEGACY_ID, result: '舊單', amount: 499, status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }
}));

let child;
let BASE = '';
// PORT=0 讓系統挑埠，從 stdout 讀回實際綁到的號碼
const started = new Promise((resolve, reject) => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', DATA_DIR, ADMIN_TOKEN: 'delivery-admin' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
    const m = out.match(/on :(\d+)/);
    if (m) { BASE = `http://127.0.0.1:${m[1]}`; resolve(); }
  });
  child.stderr.on('data', () => {});
  setTimeout(() => reject(new Error('server start timeout')), 15000);
});

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {})
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

  // 1. 建立案件（免費），帶完整董事會資料
  const made = await req('POST', '/api/case', {
    result: '太軟',
    board: { top: [{ key: 'taiyin', role: '內務總管' }, { key: 'wuqu', role: '執行長' }], bars: { B1: 40, B2: 60, B3: 50, B4: 30 } }
  });
  assert.strictEqual(made.status, 200);
  const orderId = made.json.orderId;
  const token = made.json.token;
  assert.ok(token && token.length >= 40);

  // 1a. 舊訂單（token 上線前）維持以 orderId 為憑證：可查詢，不會被補 token
  const legacy = await req('GET', `/api/order/${LEGACY_ID}`);
  assert.strictEqual(legacy.status, 200, '舊訂單不需 token 即可查詢');
  assert.strictEqual(legacy.json.status, 'open', '舊的 pending 對應到新流程的 open');
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8'));
  assert.strictEqual(onDisk[LEGACY_ID].token, undefined, '舊訂單不得被補上 token（那會把只有訂單號的客戶鎖在門外）');

  // 2. 結果式付費：付款前就能送問卷，但要留聯絡方式；錯 token 視為不存在（防列舉）
  const q = await req('GET', '/api/questionnaire');
  assert.strictEqual(q.status, 200);
  assert.strictEqual(q.json.questions.length, 7);
  const answers = {};
  q.json.questions.forEach((x) => { answers[x.id] = x.options[0]; });

  const evil = await req('POST', '/api/delivery', { orderId, token: 'nope', answers, contact: 'line:x' });
  assert.strictEqual(evil.status, 404);
  const noContact = await req('POST', '/api/delivery', { orderId, token, answers });
  assert.strictEqual(noContact.status, 400, '沒留聯絡方式不能送');
  const bad = await req('POST', '/api/delivery', { orderId, token, answers: { q1: 'x' }, contact: 'line:ken' });
  assert.strictEqual(bad.status, 400, '缺題不能送');

  const deliv = await req('POST', '/api/delivery', { orderId, token, answers, contact: 'line:ken' });
  assert.strictEqual(deliv.status, 200);
  assert.strictEqual(deliv.json.ok, true);

  // 3. 上傳照片（1x1 PNG data URL）→ 收齊，轉 submitted；檔名不得洩漏 token
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await req('POST', '/api/upload-photo', { orderId, token, photo: tinyPng });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.status, 'submitted');
  assert.match(up.json.photo, /^\/uploads\/photo-KC\d{17}-[0-9a-f]{16}\.(png|jpg)$/);
  assert.ok(!up.json.photo.includes(token.slice(0, 16)), '照片檔名不得帶 token');

  // 4. 報告資料：無 token 讀新案件 → 404；帶 token → 齊全，董事會資料隨案件帶入
  const repNoTok = await req('GET', `/api/report?order=${orderId}`);
  assert.strictEqual(repNoTok.status, 404, '新案件無 token 不得讀取');
  const rep = await req('GET', `/api/report?order=${orderId}&token=${token}`);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.json.status, 'submitted');
  assert.ok(rep.json.answers);
  assert.ok(rep.json.photo);
  assert.strictEqual(rep.json.reportReady, true);
  assert.strictEqual(rep.json.board.top[0].key, 'taiyin');
  assert.strictEqual(rep.json.board.bars.B2, 60);
  assert.strictEqual(rep.json.full, undefined, '未付款不得帶完整報告');

  // 5. 預覽出來之前不能付款；交報告後才能模擬付款；錯 token 無法偷付款
  const early = await req('POST', '/api/demo-pay', { orderId, token });
  assert.strictEqual(early.status, 409);
  const filed = await req('POST', '/api/admin/report', { orderId, preview: '預覽', full: '完整' }, { 'x-admin-token': 'delivery-admin' });
  assert.strictEqual(filed.status, 200);
  const evilPay = await req('POST', '/api/demo-pay', { orderId, token: 'nope' });
  assert.strictEqual(evilPay.status, 404);
  const pay = await req('POST', '/api/demo-pay', { orderId, token });
  assert.strictEqual(pay.json.ok, true);
  const paid = await req('GET', `/api/report?order=${orderId}&token=${token}`);
  assert.strictEqual(paid.json.status, 'paid');
  assert.strictEqual(paid.json.full, '完整');
});
