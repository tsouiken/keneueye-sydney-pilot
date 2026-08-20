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

// 輕量 .env 載入（零依賴）：本機開發用，Railway 用平台 env 覆蓋
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) {}

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
  action: process.env.ECPAY_ACTION_URL || ecpay.DEFAULT_ACTION,
  choosePayment: process.env.ECPAY_CHOOSE_PAYMENT || 'Credit'
};
const DEMO = !(ECPAY.merchantId && ECPAY.hashKey && ECPAY.hashIV);

// Make 自動化 Webhook（留空 = 不發送，不影響既有流程）
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || '';
function fireWebhook(event, payload) {
  if (!MAKE_WEBHOOK_URL) return;
  const body = JSON.stringify({ event, ...payload, sentAt: new Date().toISOString() });
  const req = http.request(MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => { res.resume(); });
  req.setTimeout(8000, () => req.destroy());
  req.on('error', () => { /* webhook 失敗不阻斷付款流程 */ });
  req.end(body);
}

// ---------- 交付流程：7 題情境問卷（第一印象／誤讀／眉眼） ----------
const QUESTIONNAIRE = [
  { id: 'q1', text: '第一次見面，你通常會被怎麼形容？', options: ['很親切、很好聊', '很專業、有距離', '很累、沒精神', '很活潑、很會講', '很安靜、很難捉摸'] },
  { id: 'q2', text: '在重要場合（面試／提案／聚會），你最常擔心別人怎麼看你？', options: ['怕被覺得不夠專業', '怕被覺得太兇、不好親近', '怕被覺得沒精神、不可靠', '怕被覺得太油、不夠真誠', '怕被覺得太軟、沒份量'] },
  { id: 'q3', text: '別人對你的評價，哪一種最常出現、也最困擾你？', options: ['「你好像很嚴肅」', '「你看起來很累」', '「你好像沒自信」', '「你太衝了」', '「你讓人摸不透」'] },
  { id: 'q4', text: '你希望別人第一次見到你，記住你什麼？', options: ['我的專業能力', '我的親和力', '我的活力與熱情', '我的可靠與穩重', '我的溫度與彈性'] },
  { id: 'q5', text: '你覺得自己「實際上是什麼樣的人」？', options: ['其實很溫暖，只是看起來冷', '其實很有活力，只是看起來累', '其實很有料，只是看起來軟', '其實很細膩，只是看起來粗', '其實很單純，只是看起來複雜'] },
  { id: 'q6', text: '你最近一次覺得「被別人誤讀了」是什麼情境？', options: ['工作提案／面試', '社交聚會／認識新朋友', '感情／親密關係', '家庭／長輩', '沒有特別感覺'] },
  { id: 'q7', text: '如果可以改善一件事，你最想讓別人的第一印象變成？', options: ['更有親和力', '更有專業份量', '更有精神狀態', '更有溫度與彈性', '更有可靠度'] }
];

// ---------- 訂單儲存（記憶體 + JSON 檔，重啟不丟） ----------
// DATA_DIR 指向持久磁碟（Railway volume 掛載點）；未設定時退回專案根目錄
const DATA_DIR = process.env.DATA_DIR || ROOT;
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
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
  fireWebhook('order.created', { orderId: id, result: result || '', amount: PRICE });
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
  let base = ROOT;
  // 上傳的照片存在持久磁碟（DATA_DIR/uploads），URL /uploads/* 需從那讀
  if (pathname.startsWith('/uploads/')) {
    base = DATA_DIR;
    rel = pathname.replace(/^\/+/, '');
  } else if (pathname === '/' || pathname === '') {
    rel = 'index.html';
  } else if (pathname === '/quiz' || pathname === '/quiz/') {
    rel = path.join('quiz', 'index.html');
  } else {
    rel = pathname.replace(/^\/+/, '');
  }

  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep) && file !== base) {
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

    // 交付流程 API
    if (p === '/api/questionnaire' && req.method === 'GET') {
      return sendJson(res, 200, { questions: QUESTIONNAIRE });
    }

    if (p === '/api/delivery' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!order) return sendJson(res, 404, { ok: false, error: '訂單不存在' });
      if (order.status !== 'paid') return sendJson(res, 400, { ok: false, error: '訂單尚未付款' });
      const answersRaw = body.answers || {};
      const answers = {};
      let ok = true;
      QUESTIONNAIRE.forEach((q) => {
        const v = answersRaw[q.id];
        if (v == null || v === '') { ok = false; return; }
        answers[q.id] = String(v);
      });
      if (!ok) return sendJson(res, 400, { ok: false, error: '請完成全部 7 題' });
      order.answers = answers;
      order.answersSubmittedAt = new Date().toISOString();
      saveOrders();
      return sendJson(res, 200, { ok: true, orderId: order.id });
    }

    if (p === '/api/upload-photo' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!order) return sendJson(res, 404, { ok: false, error: '訂單不存在' });
      if (order.status !== 'paid') return sendJson(res, 400, { ok: false, error: '訂單尚未付款' });
      const data = body.photo; // data URL 或 base64
      if (typeof data !== 'string' || data.length < 100) return sendJson(res, 400, { ok: false, error: '照片資料無效' });
      const m = data.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!m) return sendJson(res, 400, { ok: false, error: '僅支援 data URL 照片' });
      const ext = m[1] === 'image/png' ? 'png' : 'jpg';
      const fname = `photo-${order.id}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(m[2], 'base64'));
      order.photo = '/uploads/' + fname;
      order.photoSubmittedAt = new Date().toISOString();
      saveOrders();
      return sendJson(res, 200, { ok: true, photo: order.photo, orderId: order.id });
    }

    if (p === '/api/report' && req.method === 'GET') {
      const order = orders[new URLSearchParams(u.search).get('order') || ''];
      if (!order) return sendJson(res, 404, { error: '訂單不存在' });
      return sendJson(res, 200, {
        orderId: order.id,
        status: order.status,
        answers: order.answers || null,
        photo: order.photo || null,
        // ⚠️ 待接：AI 報告生成（目前為人工交付；此處僅回傳已收集的資料）
        reportReady: !!(order.answers && order.photo)
      });
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
        alg: ECPAY.alg,
        choosePayment: ECPAY.choosePayment
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
        const vAccount = params.vAccount || '';
        const paid = !!(params.PaymentDate && params.PaymentDate !== '');
        if (vAccount && !paid) {
          // ATM：第一段回傳＝虛擬帳號已產生，尚未轉帳
          order.status = 'atm_pending';
          order.bankCode = params.BankCode || '';
          order.vAccount = params.vAccount;
          order.expireDate = params.ExpireDate || '';
          saveOrders();
          fireWebhook('order.atm_pending', {
            orderId: order.id, amount: order.amount,
            bankCode: order.bankCode, vAccount: order.vAccount, expireDate: order.expireDate
          });
        } else {
          // 信用卡即時成功，或 ATM 第二段回傳＝已入帳
          order.status = 'paid';
          order.paidAt = new Date().toISOString();
          order.tradeNo = params.TradeNo || '';
          saveOrders();
          fireWebhook('order.paid', {
            orderId: order.id, amount: order.amount, result: order.result,
            tradeNo: order.tradeNo, method: vAccount ? 'ATM' : 'Credit'
          });
        }
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
      fireWebhook('order.paid', { orderId: order.id, amount: order.amount, result: order.result, tradeNo: order.tradeNo, method: 'DEMO' });
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
