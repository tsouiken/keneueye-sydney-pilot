/**
 * KenEyeCue 測驗 MVP — 零依賴 Node 伺服器
 *
 * 路由：
 *   GET  /                    → 既有首頁（index.html）
 *   GET  /quiz/               → 測驗頁
 *   GET  /quiz/*              → 測驗靜態檔
 *   GET  /enroll.html         → 既有報名頁
 *   POST /api/order           → 建立訂單（綠界或模擬模式）
 *   POST /api/pay-callback    → 綠界付款結果回傳（驗證 CheckMacValue）
 *   POST /api/demo-pay        → 模擬模式：標記付款成功
 *   GET  /api/order/:id       → 查詢訂單狀態
 *   GET  /api/health          → 健康檢查
 *
 * 安全：所有憑證只從環境變數讀取；回傳驗證金額；不輸出任何 Secret。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ecpay = require('./lib/ecpay');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PRICE = 499;
const TRADE_DESC = '第一印象被低估報告';
const ITEM_NAME = '完整第一印象報告';

// 綠界憑證（留空任一 → 模擬付款模式）
const ECPAY = {
  merchantId: process.env.ECPAY_MERCHANT_ID || '',
  hashKey: process.env.ECPAY_HASH_KEY || '',
  hashIV: process.env.ECPAY_HASH_IV || '',
  alg: (process.env.ECPAY_HASH_ALG || 'sha256').toLowerCase() === 'md5' ? 'md5' : 'sha256',
  action: process.env.ECPAY_ACTION_URL || ecpay.DEFAULT_ACTION
};
const DEMO = !(ECPAY.merchantId && ECPAY.hashKey && ECPAY.hashIV);

// ---------- 訂單儲存（記憶體 + JSON 檔，重啟不丟） ----------
const ORDERS_FILE = path.join(ROOT, 'orders.json');
let orders = {};
try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch (_) { /* 首次啟動無檔 */ }

function saveOrders() {
  try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); } catch (_) { /* 唯讀環境不阻斷 */ }
}

function createOrder(result) {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // 14 位
  const rand = String(Math.floor(Math.random() * 900) + 100);           // 3 位
  const id = 'KC' + ts + rand;                                          // 19 字元 ≤ 20
  orders[id] = {
    id,
    result: result || '',
    amount: PRICE,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  saveOrders();
  return orders[id];
}

// ---------- 靜態檔 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let rel;
  if (pathname === '/' || pathname === '') rel = 'index.html';
  else if (pathname === '/quiz' || pathname === '/quiz/') rel = path.join('quiz', 'index.html');
  else rel = pathname.replace(/^\/+/, '');

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- 工具 ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  try {
    // API
    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, demo: DEMO, price: PRICE });
    }

    if (p === '/api/order' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = createOrder(body.result);

      if (DEMO) {
        return sendJson(res, 200, { demo: true, orderId: order.id });
      }

      const params = ecpay.buildOrderParams({
        merchantId: ECPAY.merchantId,
        orderId: order.id,
        amount: PRICE,
        tradeDesc: TRADE_DESC,
        itemName: ITEM_NAME,
        returnUrl: `${BASE_URL}/api/pay-callback`,
        clientBackUrl: `${BASE_URL}/quiz/success.html?order=${order.id}`,
        alg: ECPAY.alg
      });
      params.CheckMacValue = ecpay.checkMacValue(params, ECPAY.hashKey, ECPAY.hashIV, ECPAY.alg);
      return sendJson(res, 200, { demo: false, orderId: order.id, formAction: ECPAY.action, formFields: params });
    }

    if (p === '/api/pay-callback' && req.method === 'POST') {
      const raw = await readBody(req);
      const params = Object.fromEntries(new URLSearchParams(raw));

      if (!ecpay.verifyCheckMacValue(params, ECPAY.hashKey, ECPAY.hashIV, ECPAY.alg)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('0|CheckMacValue 驗證失敗');
      }
      const order = orders[params.MerchantTradeNo];
      if (!order) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('0|訂單不存在');
      }
      if (Number(params.TotalAmount) !== PRICE) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('0|金額不符');
      }
      if (params.RtnCode === '1') {
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        order.tradeNo = params.TradeNo || '';
        saveOrders();
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('1|OK');
    }

    if (p === '/api/demo-pay' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!order) return sendJson(res, 404, { ok: false, error: '訂單不存在' });
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.tradeNo = 'DEMO-' + order.id;
      saveOrders();
      return sendJson(res, 200, { ok: true, orderId: order.id });
    }

    const orderMatch = p.match(/^\/api\/order\/([A-Za-z0-9]+)$/);
    if (orderMatch && req.method === 'GET') {
      const order = orders[orderMatch[1]];
      if (!order) return sendJson(res, 404, { error: '訂單不存在' });
      return sendJson(res, 200, { id: order.id, status: order.status, amount: order.amount, result: order.result });
    }

    // 靜態檔
    if (req.method === 'GET') return serveStatic(req, res, p);

    res.writeHead(405); res.end('Method Not Allowed');
  } catch (err) {
    sendJson(res, 500, { error: '伺服器錯誤' });
  }
});

server.listen(PORT, () => {
  console.log(`KenEyeCue quiz server on :${PORT} (demo=${DEMO ? 'yes' : 'no'})`);
});
