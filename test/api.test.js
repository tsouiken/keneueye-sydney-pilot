'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// 用 PORT=0 讓系統挑埠，從 stdout 讀回實際綁到的號碼（固定範圍 random 會撞埠）
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kec-api-'));
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: '0', DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe']
});
const ready = new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => reject(new Error('server 啟動逾時：' + buf)), 15000);
  child.stdout.on('data', (c) => {
    buf += c;
    const m = buf.match(/on :(\d+)/);
    if (m) { clearTimeout(to); resolve(`http://127.0.0.1:${m[1]}`); }
  });
  child.once('exit', (code) => { clearTimeout(to); reject(new Error('server 提前結束，code=' + code)); });
});
let BASE = '';

function req(method, url, body) {
  return fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

test('API 完整流程（模擬付款模式）', async (t) => {
  BASE = await ready;
  t.after(() => { child.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

  // 1. 健康檢查
  const health = await req('GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.json.demo, true, '未設綠界憑證應為模擬模式');
  assert.strictEqual(health.json.price, 499);

  // 2. 建立案件（免費）→ 回傳 orderId + 高熵 token；董事會資料一起帶進來
  const made = await req('POST', '/api/case', {
    result: '董事會：董事長、策略長',
    board: { top: [{ key: 'ziwei', role: '董事長' }, { key: 'tianji', role: '策略長' }], bars: { B1: 70, B2: 40, B3: 55, B4: 60 } }
  });
  assert.strictEqual(made.status, 200);
  const orderId = made.json.orderId;
  const token = made.json.token;
  assert.match(orderId, /^KC\d{17}$/, '案件編號格式 KC + 17 位數字');
  assert.ok(token && token.length >= 40, '案件需回傳高熵 token');

  // 3. 無 token 或錯 token 皆視為不存在（防列舉）
  const noTok = await req('GET', `/api/order/${orderId}`);
  assert.strictEqual(noTok.status, 404);
  const badTok = await req('GET', `/api/order/${orderId}?token=wrong`);
  assert.strictEqual(badTok.status, 404);

  // 4. 案件初始為 open（帶正確 token）
  const opened = await req('GET', `/api/order/${orderId}?token=${token}`);
  assert.strictEqual(opened.json.status, 'open');
  assert.strictEqual(opened.json.amount, 499);
  assert.strictEqual(opened.json.result, '董事會：董事長、策略長');

  // 5. 董事會資料存進案件（只留白名單欄位）
  const rep = await req('GET', `/api/report?order=${orderId}&token=${token}`);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.json.board.top[0].key, 'ziwei');
  assert.strictEqual(rep.json.board.top[0].role, '董事長');
  assert.strictEqual(rep.json.board.bars.B1, 70);

  // 6. 結果式付費：報告預覽出來之前不能付款
  const tooEarly = await req('POST', '/api/order', { orderId, token });
  assert.strictEqual(tooEarly.status, 409);
  const demoTooEarly = await req('POST', '/api/demo-pay', { orderId, token });
  assert.strictEqual(demoTooEarly.status, 409, '模擬付款同樣要等預覽');

  // 7. 不存在的案件 → 404
  const missing = await req('GET', '/api/order/KC00000000000000000?token=abc');
  assert.strictEqual(missing.status, 404);

  // 8. 靜態頁面可存取
  const quiz = await fetch(BASE + '/quiz/');
  assert.strictEqual(quiz.status, 200);
  assert.ok((await quiz.text()).includes('董事會遊戲'));
  for (const pg of ['/quiz/result.html', '/quiz/submit.html', '/quiz/report.html', '/quiz/checkout.html', '/quiz/success.html', '/quiz/quiz-logic.js', '/quiz/quiz-data.js', '/quiz/quiz.css']) {
    const r = await fetch(BASE + pg);
    assert.strictEqual(r.status, 200, `${pg} 應可存取`);
  }

  // 9. 非公開檔案一律擋掉（orders.json / .env / 程式碼）
  const blocked = ['/orders.json', '/.env', '/server.js', '/package.json', '/ENV', '/test/paywall.test.js', '/docs/quiz-mvp.md'];
  for (const bp of blocked) {
    const r = await fetch(BASE + bp);
    assert.strictEqual(r.status, 404, `${bp} 應被擋下`);
  }

  // 10. 路徑穿越防護：URL 正規化後，任何嘗試都讀不到 ROOT 以外的檔案
  const port = Number(new URL(BASE).port);
  const evil = await new Promise((resolve, reject) => {
    const net = require('node:net');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET /../../../../etc/passwd HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    sock.on('data', (c) => { data += c; });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
  assert.match(evil, /^HTTP\/1\.1 404/, '穿越嘗試不得讀到 ROOT 以外的檔案');
});
