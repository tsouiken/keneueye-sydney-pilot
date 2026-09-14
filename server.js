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
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// 結果式付費：人工分析發生在收錢之前，所以要限制同一個聯絡方式
// 同時能有幾件「還沒付款」的案件在跑，否則跑單成本沒有上限。
const MAX_OPEN_PER_CONTACT = Number(process.env.MAX_OPEN_PER_CONTACT || 2);
// 結果式付費把照片上傳搬到了付款之前，而且不需要聯絡方式就能做。
// 任何人都能「開案件→拿 token→傳 5MB」重複灌爆持久磁碟，
// MAX_OPEN_PER_CONTACT 擋不到（那要先過 /api/delivery）。
const MAX_CASES_PER_IP_HOUR = Number(process.env.MAX_CASES_PER_IP_HOUR || 10);
const MAX_UPLOADS_PER_IP_HOUR = Number(process.env.MAX_UPLOADS_PER_IP_HOUR || 10);
// 未付款照片的總量上限（位元組）。到頂就先不收新的，已付款的不算在內。
const MAX_UNPAID_PHOTO_BYTES = Number(process.env.MAX_UNPAID_PHOTO_BYTES || 200 * 1024 * 1024);
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
  const lib = MAKE_WEBHOOK_URL.startsWith('https') ? https : http;
  const req = lib.request(MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => { res.resume(); });
  req.setTimeout(8000, () => req.destroy());
  req.on('error', () => { /* webhook 失敗不阻斷付款流程 */ });
  req.end(body);
}

// LINE 成交通知（用官方帳號 token 直接推給 Ken；留空 = 不發送，不影響既有流程）
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const KEN_LINE_USER_ID = process.env.KEN_LINE_USER_ID || '';
const LINE_NOTIFY_ON_DEMO = process.env.LINE_NOTIFY_ON_DEMO === '1';
function sendLine(text) {
  if (!LINE_ACCESS_TOKEN || !KEN_LINE_USER_ID) return;
  const body = JSON.stringify({ to: KEN_LINE_USER_ID, messages: [{ type: 'text', text }] });
  // 必須用 https：http.request 收到 https:// 會同步拋 ERR_INVALID_PROTOCOL，
  // req.on('error') 攔不到，會讓呼叫端整個 500。
  const req = https.request('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN,
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => { res.resume(); });
  req.setTimeout(8000, () => req.destroy());
  req.on('error', () => { /* LINE 通知失敗不阻斷付款流程 */ });
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

// 舊訂單（token 上線前建立的）沒有 token。這些客戶唯一拿過的憑證就是
// success.html?order=ID，補 token 反而把他們鎖在門外——所以永遠不補，
// 授權規則見 orderAuthorized()。這裡只把舊的 pending 對應到新流程的 open。
function migrateLegacyOrders() {
  let changed = 0;
  let legacy = 0;
  Object.values(orders).forEach(function (o) {
    if (!o.token) legacy++;
    // 舊的 pending＝訂單已建立、還沒付款，對應新流程的 open
    if (o.status === 'pending') {
      o.status = 'open';
      changed++;
    }
  });
  if (changed) {
    saveOrders();
    console.log('[migrate] ' + changed + ' 筆舊訂單 pending → open');
  }
  if (legacy) console.log('[legacy] ' + legacy + ' 筆無 token 的舊訂單，憑訂單號存取');
}
migrateLegacyOrders();

// 案件狀態機（結果式付費）：
//   open          建立，尚未收到問卷／照片
//   submitted     問卷＋照片都收齊，等 Ken 分析
//   preview_ready 報告已寫好，對方可看預覽
//   atm_pending   ATM 虛擬帳號已產生，尚未入帳
//   paid          已付款，完整報告解鎖
// 綠界的 MerchantTradeNo 不能重複。同一個案件可能付款失敗後重試，
// 所以每次嘗試都要配一組新的，回傳時再對應回案件。
function tradeNoTaken(no) {
  if (orders[no]) return true;
  return Object.values(orders).some(function (o) {
    return Array.isArray(o.paymentRefs) && o.paymentRefs.indexOf(no) !== -1;
  });
}

// 繳費期限那天結束前都算還付得進去。讀不出期限就當作仍有效——
// 寧可擋住重複建立，也不要開出第二組會被重複入帳的帳號。
function atmExpired(order) {
  const m = String(order.expireDate || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return false;
  return Date.now() > new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
}

function newPaymentRef() {
  // 綠界的 MerchantTradeNo 上限 20 字元：'KP' + 14 碼時間 + 4 碼亂數。
  // 原本是 3 碼十進位（同一秒只有 900 種）且完全不查碰撞，兩個人同一秒
  // 結帳就可能拿到同一組，後送的那筆會被綠界當重複退掉。
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  for (let i = 0; i < 50; i++) {
    const rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).slice(-4).padStart(4, '0');
    const ref = 'KP' + ts + rand;
    if (!tradeNoTaken(ref)) return ref;
  }
  // 極端狀況：再加一段亂數換掉時間尾巴，總長仍是 20
  return 'KP' + ts.slice(0, 10) + crypto.randomBytes(4).toString('hex').slice(0, 8);
}

// 綠界回傳時用交易編號找回案件：先試舊格式（案件編號本身），再查歷次付款嘗試
function findCaseByTradeNo(no) {
  if (!no) return null;
  if (orders[no]) return orders[no];
  return Object.values(orders).find(function (o) {
    return Array.isArray(o.paymentRefs) && o.paymentRefs.indexOf(no) !== -1;
  }) || null;
}

// 董事會資料只存白名單欄位（top 前 3 的 key/role ＋ 四血條），避免塞入任意物件
function sanitizeBoard(board) {
  if (!board || typeof board !== 'object' || !Array.isArray(board.top)) return null;
  return {
    top: board.top.slice(0, 3).map(function (m) {
      return {
        key: String((m && m.key) || '').slice(0, 20),
        role: String((m && m.role) || '').slice(0, 40)
      };
    }),
    bars: board.bars && typeof board.bars === 'object' ? {
      B1: Number(board.bars.B1) || 0,
      B2: Number(board.bars.B2) || 0,
      B3: Number(board.bars.B3) || 0,
      B4: Number(board.bars.B4) || 0
    } : null
  };
}

function createCase(result, board) {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // 14 位
  const rand = String(Math.floor(Math.random() * 900) + 100);           // 3 位
  const id = 'KC' + ts + rand;                                          // 19 字元 ≤ 20
  orders[id] = {
    id,
    // 高熵存取憑證：報告與付款網址都要帶，避免靠猜訂單號翻到別人的資料
    token: crypto.randomBytes(24).toString('hex'),
    result: result || '',
    board: sanitizeBoard(board) || null,
    amount: PRICE,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  saveOrders();
  // 這裡不發 order.created。開啟 submit.html 就會呼叫 /api/case，
  // 在這裡發等於把「有人開了頁面又關掉」也記成一筆潛在名單。
  // 改在對方真的留下聯絡方式時才發（見 /api/delivery）。
  return orders[id];
}

// 後台驗證：ADMIN_TOKEN 沒設就整組後台關閉
function adminOk(req) {
  if (!ADMIN_TOKEN) return false;
  const got = req.headers['x-admin-token'];
  if (typeof got !== 'string') return false;
  const a = Buffer.from(ADMIN_TOKEN, 'utf8');
  const b = Buffer.from(got, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 常數時間比對：token 長度不同 → 直接視為不符
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// 訂單授權：token 上線前的舊訂單（無 token）維持以 orderId 為憑證，
// 新訂單一律要求高熵 token（錯 token 視為不存在，防列舉）
function orderAuthorized(order, token) {
  if (!order) return false;
  if (!order.token) return true;
  return safeEqual(order.token, token);
}

// 聯絡方式正規化：大小寫、空白不該讓同一個人被當成兩個人
function normalizeContact(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

// 同一個聯絡方式目前有幾件還沒付款的案件
function openCasesForContact(contact, excludeId) {
  const key = normalizeContact(contact);
  if (!key) return 0;
  return Object.values(orders).filter(function (o) {
    return o.id !== excludeId && o.status !== 'paid' && normalizeContact(o.contact) === key;
  }).length;
}

// 問卷與照片都到齊 → 進入待分析
// 重傳的照片跟已存的是同一張嗎
function samePhoto(order, buf) {
  try {
    const cur = fs.readFileSync(path.join(DATA_DIR, String(order.photo).replace(/^\/+/, '')));
    return cur.length === buf.length && cur.equals(buf);
  } catch (_) {
    return false; // 讀不到舊檔就不能斷定相同
  }
}

// 重送的內容跟已收的一模一樣嗎（用來判斷「這是重試」而不是「這是修改」）
function sameAnswers(order, answers, contact) {
  if ((order.contact || '') !== contact) return false;
  const a = order.answers || {};
  const ka = Object.keys(a).sort();
  const kb = Object.keys(answers).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a[k] === answers[k]);
}

function markSubmittedIfComplete(order) {
  if (!order.answers || !order.photo) return;
  if (order.status === 'open') {
    order.status = 'submitted';
    order.submittedAt = new Date().toISOString();
    fireWebhook('case.submitted', { orderId: order.id, result: order.result, board: order.board || null, contact: order.contact || '' });
    sendLine('【KenEyeCue 待分析】\n案件：' + order.id + '\n測驗：' + (order.result || '—') + '\n聯絡：' + (order.contact || '—') + '\n→ 問卷與照片已收齊，可以開始寫報告');
    return;
  }
  // 舊流程是先付款才補資料。狀態不能從 paid 降回 submitted，
  // 但資料剛收齊一樣要通知——而且這種更該先寫，錢已經收了。
  if (order.status === 'paid' && !order.full && !order.submittedAt) {
    order.submittedAt = new Date().toISOString();
    fireWebhook('case.submitted', { orderId: order.id, result: order.result, board: order.board || null, contact: order.contact || '' });
    sendLine('【KenEyeCue 待分析（已付款）】\n案件：' + order.id + '\n測驗：' + (order.result || '—') + '\n聯絡：' + (order.contact || '—') + '\n→ 舊流程的付款案件補齊資料了，請優先寫');
  }
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

// 白名單：只服務明確公開的根目錄頁面與 quiz/ 資源，其餘一律 404
// （避免 /orders.json、/.env、/server.js、/package.json、test/、docs/ 等被直接讀取；
//   DATA_DIR 沒設時 orders.json 就在專案根目錄，和靜態檔同一個地方）
function isPublicStatic(rel, pathname) {
  if (pathname === '/' || pathname === '') return true;
  if (pathname === '/quiz' || pathname === '/quiz/') return true;
  const ROOT_PAGES = new Set(['index.html', 'firstimpression.html', 'enroll.html', 'report.html']);
  if (ROOT_PAGES.has(rel)) return true;
  if (/^quiz\/[A-Za-z0-9._-]+$/.test(rel) && /\.(html|css|js|png|jpg|jpeg|svg|ico)$/.test(rel)) return true;
  return false;
}

function serveStatic(req, res, pathname) {
  let rel;
  let base = ROOT;
  // 上傳的照片存在持久磁碟（DATA_DIR/uploads），URL /uploads/* 需從那讀
  if (pathname.startsWith('/uploads/')) {
    base = UPLOAD_DIR;
    rel = pathname.slice('/uploads/'.length);
  } else if (pathname === '/' || pathname === '') {
    rel = 'index.html';
  } else if (pathname === '/quiz' || pathname === '/quiz/') {
    rel = path.join('quiz', 'index.html');
  } else {
    rel = pathname.replace(/^\/+/, '');
    if (!isPublicStatic(rel, pathname)) {
      res.writeHead(404); res.end('Not Found'); return;
    }
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
// 一般 JSON 請求的上限。照片走另一條，見 MAX_PHOTO_BODY。
const MAX_BODY = 1e6;
// 對外承諾的照片上限，指的是原始檔案大小。
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// base64 會脹成 4/3，再加上 data URL 前綴與 JSON 外框，
// 所以傳輸上限要比 MAX_PHOTO_BYTES 寬，否則前端說 5MB、伺服器 1MB 就砍掉。
const MAX_PHOTO_BODY = 8 * 1024 * 1024;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      raw += c;
      if (raw.length > limit) {
        // 超過就別再累積（記憶體要有上限），但不要 destroy，
        // 不然回不了 413，對方只會看到連線被砍。
        over = true;
        raw = '';
        const err = new Error('請求內容太大');
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on('end', () => { if (!over) resolve(raw); });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

// 這是成本上限，不是身分驗證：Railway 在 proxy 後面，remoteAddress 永遠是
// proxy，只剩 X-Forwarded-For 可用，而它是可以偽造的。跟 MAX_OPEN_PER_CONTACT
// 一樣，目的是讓隨手灌爆的成本變高，不是擋得住有心人。
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}

const hitLog = new Map(); // key -> 時間戳陣列
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const hits = (hitLog.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { hitLog.set(key, hits); return true; }
  hits.push(now);
  hitLog.set(key, hits);
  // 順手清掉過期的鍵，這個 Map 不能無限長大
  if (hitLog.size > 5000) {
    for (const [k, v] of hitLog) {
      if (!v.some((t) => now - t < windowMs)) hitLog.delete(k);
    }
  }
  return false;
}

// 單一案件照片檔的大小（檔案不在就當 0）
function photoBytes(order) {
  try {
    return fs.statSync(path.join(DATA_DIR, String(order.photo).replace(/^\/+/, ''))).size;
  } catch (_) {
    return 0;
  }
}

// 未付款案件目前佔用的照片位元組數。檔案不多，直接量最誠實。
function unpaidPhotoBytes() {
  let total = 0;
  for (const o of Object.values(orders)) {
    if (o.status === 'paid' || !o.photo) continue;
    total += photoBytes(o);
  }
  return total;
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
      if (!orderAuthorized(order, body.token)) return sendJson(res, 404, { ok: false, error: '案件不存在' });
      const contact = String(body.contact || '').trim();
      if (contact.length < 3) return sendJson(res, 400, { ok: false, error: '請留下聯絡方式，報告好了才通知得到你' });

      const answersRaw = body.answers || {};
      const answers = {};
      let ok = true;
      QUESTIONNAIRE.forEach((q) => {
        const v = answersRaw[q.id];
        if (v == null || v === '') { ok = false; return; }
        answers[q.id] = String(v);
      });
      if (!ok) return sendJson(res, 400, { ok: false, error: '請完成全部 7 題' });

      // 結果式付費：問卷在付款「之前」收，所以這裡不擋未付款。
      // 要擋的是「覆蓋掉報告所依據的輸入」，不是「不是 open 就一律拒絕」——
      // 舊流程是先付款才收資料，那些 paid 但還沒交作答的案件得補得進來，
      // 而新的付款後頁面已經沒有那張表單了。
      if (order.answers && order.status !== 'open') {
        // 一模一樣的內容重送＝上傳成功但回應掉了、前端重試。
        // 這種要當成功處理，否則對方會卡在表單上，而資料其實早就收齊了。
        if (sameAnswers(order, answers, contact)) {
          return sendJson(res, 200, { ok: true, orderId: order.id, status: order.status, repeat: true });
        }
        return sendJson(res, 409, { ok: false, error: '這個案件已經送出了，不能再修改作答。' });
      }

      // 未付款的案件會佔用人工分析的時間，同一個聯絡方式不能無限排隊
      if (openCasesForContact(contact, order.id) >= MAX_OPEN_PER_CONTACT) {
        return sendJson(res, 429, {
          ok: false,
          error: '你已經有還在處理中的案件。等上一份報告完成之後再送新的。'
        });
      }

      const firstTime = !order.answers;
      order.answers = answers;
      order.contact = contact;
      order.answersSubmittedAt = new Date().toISOString();
      markSubmittedIfComplete(order);
      saveOrders();
      // 到這裡對方才真的留下了聯絡方式，這時候才算一筆潛在名單。
      // 事件名稱維持 order.created：已經上線的 Make router 是照這個名字分支的
      // （.env.example 與 docs/make-automation.md 都這樣寫）。
      if (firstTime) {
        fireWebhook('order.created', {
          orderId: order.id, board: order.board || null, result: order.result || '', amount: order.amount, contact
        });
      }
      return sendJson(res, 200, { ok: true, orderId: order.id, status: order.status });
    }

    if (p === '/api/upload-photo' && req.method === 'POST') {
      if (rateLimited('photo:' + clientIp(req), MAX_UPLOADS_PER_IP_HOUR, 3600e3)) {
        return sendJson(res, 429, { ok: false, error: '短時間內上傳太多次了，請稍後再試。' });
      }
      const body = JSON.parse((await readBody(req, MAX_PHOTO_BODY)) || '{}');
      const order = orders[body.orderId];
      if (!orderAuthorized(order, body.token)) return sendJson(res, 404, { ok: false, error: '案件不存在' });
      // 擋的是「換掉報告所依據的照片」。還沒有照片的舊 paid 案件要補得上來，
      // 否則付過錢的人既補不了資料也拿不到報告。實際比對放在拿到 buffer 之後。
      const data = body.photo; // data URL 或 base64
      if (typeof data !== 'string' || data.length < 100) return sendJson(res, 400, { ok: false, error: '照片資料無效' });
      const m = data.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!m) return sendJson(res, 400, { ok: false, error: '僅支援 data URL 照片' });
      const buf = Buffer.from(m[2], 'base64');
      // 前端也擋，但前端擋得住的只有誠實的前端
      if (buf.length > MAX_PHOTO_BYTES) {
        return sendJson(res, 413, { ok: false, error: '照片太大（限 5MB）' });
      }
      if (order.photo && order.status !== 'open') {
        // 一模一樣的照片重傳＝回應掉了、前端重試，當成功處理（冪等）。
        // 換成另一張才是「修改」，那要擋——報告可能已經照舊照片寫好了。
        if (samePhoto(order, buf)) {
          return sendJson(res, 200, { ok: true, photo: order.photo, orderId: order.id, status: order.status, repeat: true });
        }
        return sendJson(res, 409, { ok: false, error: '這個案件已經送出了，不能再更換照片。' });
      }
      // 配額是給未付款案件用的：已付款案件的照片不算在 unpaidPhotoBytes() 裡，
      // 擋掉它只會讓付過錢的人補不完資料。
      // 而且要把「這一張」也算進去——只看已經存好的檔案，等於每次都能再超收
      // 一張照片的量（上限設小的時候差很多）。同一件重傳時要扣掉舊檔，
      // 否則自己會被自己的舊照片算兩次。
      if (order.status !== 'paid') {
        const existing = order.photo ? photoBytes(order) : 0;
        if (unpaidPhotoBytes() - existing + buf.length > MAX_UNPAID_PHOTO_BYTES) {
          return sendJson(res, 507, { ok: false, error: '目前排隊的案件太多，請晚點再送。' });
        }
      }
      const ext = m[1] === 'image/png' ? 'png' : 'jpg';
      // 檔名帶 token：/uploads/* 是公開靜態路徑，未付款者的照片也會存在這裡，
      // 檔名必須猜不到，否則靠訂單號就能翻到別人的臉。
      const fname = `photo-${order.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
      // open 案件可以換照片：舊檔要刪，不然 unpaidPhotoBytes() 只算指標指到的那個，
      // 被換掉的檔會留在磁碟上、又不在配額裡，等於可以無限灌。
      // 只刪 UPLOAD_DIR 底下、且不是剛寫的那個檔。
      if (order.photo && order.photo !== '/uploads/' + fname) {
        const oldFile = path.resolve(UPLOAD_DIR, String(order.photo).replace(/^\/uploads\//, ''));
        if (oldFile.startsWith(UPLOAD_DIR + path.sep)) {
          try { fs.unlinkSync(oldFile); } catch (_) { /* 已不在就算了 */ }
        }
      }
      order.photo = '/uploads/' + fname;
      order.photoSubmittedAt = new Date().toISOString();
      markSubmittedIfComplete(order);
      saveOrders();
      return sendJson(res, 200, { ok: true, photo: order.photo, orderId: order.id, status: order.status });
    }

    if (p === '/api/report' && req.method === 'GET') {
      const qs = new URLSearchParams(u.search);
      const order = orders[qs.get('order') || ''];
      if (!orderAuthorized(order, qs.get('token') || '')) return sendJson(res, 404, { error: '案件不存在' });

      const paid = order.status === 'paid';
      const payload = {
        orderId: order.id,
        status: order.status,
        amount: order.amount,
        result: order.result || '',
        answers: order.answers || null,
        photo: order.photo || null,
        board: order.board || null,
        reportReady: !!(order.answers && order.photo),
        duplicatePayment: Array.isArray(order.duplicatePayments) && order.duplicatePayments.length > 0,
        previewReady: !!order.preview,
        preview: order.preview || null,
        // ATM 待付款時要把虛擬帳號帶給對方，否則他不知道要轉去哪
        bankCode: order.bankCode || '',
        vAccount: order.vAccount || '',
        expireDate: order.expireDate || ''
      };
      // ⚠️ 付費邊界：完整報告只有付款後才離開伺服器。
      // 未付款一律不帶 full 欄位，不能只靠前端隱藏。
      if (paid) payload.full = order.full || null;
      return sendJson(res, 200, payload);
    }

    // 建立案件（免費，測驗做完就建）
    if (p === '/api/case' && req.method === 'POST') {
      if (rateLimited('case:' + clientIp(req), MAX_CASES_PER_IP_HOUR, 3600e3)) {
        return sendJson(res, 429, { error: '短時間內開太多案件了，請稍後再試。' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = createCase(body.result, body.board);
      return sendJson(res, 200, { orderId: order.id, token: order.token });
    }

    // ---------- 後台（都需要 ADMIN_TOKEN） ----------
    // 待辦佇列：預設只列還沒交報告的案件
    if (p === '/api/admin/cases' && req.method === 'GET') {
      if (!adminOk(req)) return sendJson(res, 403, { error: '無權限' });
      const all = String(new URLSearchParams(u.search).get('all') || '') === '1';
      const list = Object.values(orders)
        // 已付款但還沒寫報告的也要列進來（舊流程留下的案件會是這樣），
        // 否則對方付了錢卻在佇列裡看不到，等於沒人知道還欠他一份報告。
        .filter(function (o) {
          if (all) return true;
          if (o.status === 'submitted' || o.status === 'open') return true;
          return o.status === 'paid' && !o.preview;
        })
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
        .map(function (o) {
          return {
            id: o.id,
            status: o.status,
            result: o.result || '',
            contact: o.contact || '',
            createdAt: o.createdAt,
            submittedAt: o.submittedAt || null,
            hasAnswers: !!o.answers,
            hasPhoto: !!o.photo,
            hasReport: !!o.preview
          };
        });
      return sendJson(res, 200, { cases: list, count: list.length });
    }

    // 單一案件明細：Ken 要看作答與照片才寫得出報告
    const adminCase = p.match(/^\/api\/admin\/case\/([A-Za-z0-9]+)$/);
    if (adminCase && req.method === 'GET') {
      if (!adminOk(req)) return sendJson(res, 403, { error: '無權限' });
      const order = orders[adminCase[1]];
      if (!order) return sendJson(res, 404, { error: '案件不存在' });
      return sendJson(res, 200, {
        id: order.id,
        status: order.status,
        result: order.result || '',
        contact: order.contact || '',
        createdAt: order.createdAt,
        submittedAt: order.submittedAt || null,
        answers: order.answers || null,
        photo: order.photo || null,
        preview: order.preview || '',
        full: order.full || '',
        board: order.board || null,
        legacy: !order.token,
        duplicatePayments: order.duplicatePayments || [],
        // 讓 Ken 能把報告連結直接貼給對方（舊訂單沒有 token，憑訂單號就開得了）
        reportUrl: '/quiz/report.html?order=' + order.id + (order.token ? '&token=' + order.token : '')
      });
    }

    // Ken 交報告用：需要 ADMIN_TOKEN
    if (p === '/api/admin/report' && req.method === 'POST') {
      if (!ADMIN_TOKEN) return sendJson(res, 503, { ok: false, error: '未設定 ADMIN_TOKEN' });
      if (!adminOk(req)) return sendJson(res, 403, { ok: false, error: '無權限' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!order) return sendJson(res, 404, { ok: false, error: '案件不存在' });
      const preview = String(body.preview || '').trim();
      const full = String(body.full || '').trim();
      if (!preview || !full) return sendJson(res, 400, { ok: false, error: 'preview 與 full 都必填' });
      // 資料沒收齊不能交報告：佇列裡有 open 案件，對它交了報告會直接變 preview_ready，
      // 之後補進來的作答／照片不會讓報告失效——那份報告是在沒有資料的情況下寫的。
      // 只看資料不看狀態，所以舊流程先付款的案件補齊之後照樣能交。
      if (!order.answers || !order.photo) {
        return sendJson(res, 409, { ok: false, error: '問卷與照片還沒收齊，還不能交報告', status: order.status });
      }
      order.preview = preview;
      order.full = full;
      // paid 不能降級；atm_pending 也不行——虛擬帳號還付得進去，
      // 打回 preview_ready 會讓對方看不到帳號、被請去重開一筆結帳。
      if (order.status !== 'paid' && order.status !== 'atm_pending') {
        order.status = 'preview_ready';
      }
      order.reportReadyAt = new Date().toISOString();
      saveOrders();
      fireWebhook('case.preview_ready', { orderId: order.id, board: order.board || null, contact: order.contact || '' });
      return sendJson(res, 200, { ok: true, orderId: order.id, status: order.status });
    }

    if (p === '/api/order' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!orderAuthorized(order, body.token)) return sendJson(res, 404, { error: '案件不存在' });
      // 已付款就不再開新的付款嘗試（兩個分頁各付一次＝收兩次錢）
      if (order.status === 'paid') {
        return sendJson(res, 409, { error: '這筆已經付款了', status: 'paid' });
      }
      // 結果式付費：報告預覽出來之前不開放付款
      if (order.status !== 'preview_ready' && order.status !== 'atm_pending') {
        return sendJson(res, 409, { error: '報告尚未完成，還不能付款', status: order.status });
      }
      // 已經有一組還沒過期的 ATM 虛擬帳號時，不能再開第二筆：
      // 舊的那組照樣付得進去，兩邊都入帳就是同一份報告收兩次錢。
      if (order.status === 'atm_pending' && order.vAccount && !atmExpired(order)) {
        return sendJson(res, 409, {
          error: '這筆已經有可以轉帳的虛擬帳號了，請直接轉帳，不要重複建立。',
          status: 'atm_pending',
          bankCode: order.bankCode || '',
          vAccount: order.vAccount,
          expireDate: order.expireDate || ''
        });
      }

      if (DEMO) {
        return sendJson(res, 200, { demo: true, orderId: order.id });
      }

      // 每次付款嘗試配一組新的交易編號，取消後重試才不會被綠界擋成重複
      const payRef = newPaymentRef();
      order.paymentRefs = order.paymentRefs || [];
      order.paymentRefs.push(payRef);
      // 最新開出的這筆是「現行嘗試」。舊的 ref 留在 paymentRefs 供回傳查找——
      // 綠界先扣款才通知我們，所以被取代的那筆若真的付成功，仍然要認（見回傳處理）。
      order.activePaymentRef = payRef;
      saveOrders();

      const params = ecpay.buildOrderParams({
        merchantId: ECPAY.merchantId,
        orderId: payRef,
        amount: PRICE,
        tradeDesc: TRADE_DESC,
        itemName: ITEM_NAME,
        returnUrl: `${BASE_URL}/api/pay-callback`,
        // 帶上 token：success.html 要靠它組出完整報告連結，
        // 少了它真的付完錢的人會回到一個打不開報告的頁面。
        clientBackUrl: `${BASE_URL}/quiz/success.html?order=${order.id}&token=${order.token}`,
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
      const ref = params.MerchantTradeNo;
      const order = findCaseByTradeNo(ref);
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
          // ATM：第一段回傳＝虛擬帳號已產生，尚未轉帳。
          // 已付款就不能被打回去：重試付款時，A 次的虛擬帳號通知可能晚於
          // B 次的成功通知才到，照收會把 paid 覆蓋成 atm_pending，
          // 等於把客戶已經買到的完整報告重新鎖起來。
          if (order.status === 'paid') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('1|OK');
          }
          // 被取代的舊嘗試才取到號：不能蓋掉現行那筆的虛擬帳號
          if (order.activePaymentRef && ref !== order.activePaymentRef) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('1|OK');
          }
          order.status = 'atm_pending';
          order.bankCode = params.BankCode || '';
          order.vAccount = params.vAccount;
          order.expireDate = params.ExpireDate || '';
          saveOrders();
          fireWebhook('order.atm_pending', {
            orderId: order.id, amount: order.amount,
            bankCode: order.bankCode, vAccount: order.vAccount, expireDate: order.expireDate
          });
          sendLine('【KenEyeCue ATM 待付】\n訂單：' + order.id + '\n金額：NT$' + order.amount + '\n虛擬帳號：' + order.vAccount + '（' + order.bankCode + '）\n到期：' + order.expireDate + '\n→ 入帳後自動通知你');
        } else if (order.status === 'paid') {
          // 已經付過了又來一筆成功：伺服器擋不住（綠界先扣款才通知），
          // 能做的是不覆蓋、不重發通知、記下來讓 Ken 退款。同一個 ref 重送＝綠界重試，no-op。
          order.duplicatePayments = order.duplicatePayments || [];
          // 「同一筆」的判斷要涵蓋部署前就付款的訂單：那時的回傳只存 status/tradeNo，
          // 沒有 paidRef，而舊流程的 MerchantTradeNo 就是訂單號。綠界重送那筆成功回傳
          // 時，不能因為 paidRef 是空的就記成重複付款、發退款警報。命中就把 paidRef 補上。
          const isOriginal = ref === order.paidRef ||
            (order.tradeNo && params.TradeNo && params.TradeNo === order.tradeNo) ||
            (!order.paidRef && ref === order.id);
          if (isOriginal && !order.paidRef) { order.paidRef = ref; saveOrders(); }
          const seen = order.duplicatePayments.some((d) => d.ref === ref);
          if (!isOriginal && !seen) {
            order.duplicatePayments.push({
              ref, tradeNo: params.TradeNo || '', paymentDate: params.PaymentDate || '',
              amount: Number(params.TotalAmount) || 0, receivedAt: new Date().toISOString()
            });
            saveOrders();
            fireWebhook('order.duplicate_payment', {
              orderId: order.id, amount: order.amount, tradeNo: params.TradeNo || '', paidTradeNo: order.tradeNo || ''
            });
            sendLine('【KenEyeCue 重複付款，需退款】\n訂單：' + order.id + '\n已入帳：' + (order.tradeNo || '—') + '\n重複的：' + (params.TradeNo || '—') + '（NT$' + order.amount + '）\n→ 請到綠界後台退這一筆');
          }
        } else {
          // 信用卡即時成功，或 ATM 第二段回傳＝已入帳。任何一筆嘗試都可以贏，
          // 包括被取代的那筆——錢已經扣了，不認等於客戶付了錢卻拿不到報告。
          order.status = 'paid';
          order.paidAt = new Date().toISOString();
          order.tradeNo = params.TradeNo || '';
          order.paidRef = ref;
          order.activePaymentRef = ref;
          saveOrders();
          fireWebhook('order.paid', {
            orderId: order.id, amount: order.amount, result: order.result, board: order.board || null,
            tradeNo: order.tradeNo, method: vAccount ? 'ATM' : 'Credit'
          });
          sendLine('【KenEyeCue 成單通知】\n訂單：' + order.id + '\n金額：NT$' + order.amount + '\n測驗：' + (order.result || '—') + '\n方式：' + (vAccount ? 'ATM' : 'Credit') + '\n→ 完整報告已解鎖');
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('1|OK');
    }

    if (p === '/api/demo-pay' && req.method === 'POST') {
      // 只在模擬模式開放：正式接上綠界後，這條等於免費解鎖完整報告
      if (!DEMO) return sendJson(res, 403, { ok: false, error: '未開放模擬付款' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const order = orders[body.orderId];
      if (!orderAuthorized(order, body.token)) return sendJson(res, 404, { ok: false, error: '案件不存在' });
      // 模擬付款也要守結果式付費的規則：預覽出來之前不能付
      if (order.status !== 'preview_ready' && order.status !== 'atm_pending') {
        return sendJson(res, 409, { ok: false, error: '報告尚未完成，還不能付款', status: order.status });
      }
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.tradeNo = 'DEMO-' + order.id;
      saveOrders();
      fireWebhook('order.paid', { orderId: order.id, amount: order.amount, result: order.result, board: order.board || null, tradeNo: order.tradeNo, method: 'DEMO' });
      // 模擬付款預設不推 LINE（測試會一直吵）；要看通知就設 LINE_NOTIFY_ON_DEMO=1
      if (LINE_NOTIFY_ON_DEMO) sendLine('【KenEyeCue 成單通知】\n訂單：' + order.id + '\n金額：NT$' + order.amount + '\n測驗：' + (order.result || '—') + '\n方式：DEMO\n→ 完整報告已解鎖');
      return sendJson(res, 200, { ok: true, orderId: order.id });
    }

    const orderMatch = p.match(/^\/api\/order\/([A-Za-z0-9]+)$/);
    if (orderMatch && req.method === 'GET') {
      const order = orders[orderMatch[1]];
      const token = new URLSearchParams(u.search).get('token') || '';
      if (!orderAuthorized(order, token)) return sendJson(res, 404, { error: '訂單不存在' });
      return sendJson(res, 200, { id: order.id, status: order.status, amount: order.amount, result: order.result });
    }

    // 靜態檔
    if (req.method === 'GET') return serveStatic(req, res, p);

    res.writeHead(405); res.end('Method Not Allowed');
  } catch (err) {
    if (err && err.statusCode) {
      return sendJson(res, err.statusCode, { ok: false, error: err.message || '請求無效' });
    }
    sendJson(res, 500, { error: '伺服器錯誤' });
  }
});

server.listen(PORT, () => {
  // 印實際綁到的埠而不是 PORT：PORT=0 時由系統挑一個空的，
  // 測試就不必猜埠號，也不會互相或跟別的程序撞在一起。
  const bound = server.address().port;
  console.log(`KenEyeCue quiz server on :${bound} (demo=${DEMO ? 'yes' : 'no'})`);
});
