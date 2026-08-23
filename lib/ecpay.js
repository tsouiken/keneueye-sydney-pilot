/**
 * ECPay 綠界 AIO 金流 — 純函式（可單獨測試）
 * 所有憑證一律從環境變數讀取，絕不寫死、絕不輸出。
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_ACTION = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

/**
 * 產生 CheckMacValue（對齊綠界官方 PHP SDK 演算法）
 * 1. 參數依名稱「不分大小寫」排序
 * 2. 組字串：HashKey=K&k1=v1&...&HashIV=IV
 * 3. URL encode 後整串轉小寫，再還原 - _ . ! * ( )，空白轉 +
 * 4. SHA256 / MD5，輸出大寫 hex
 */
function checkMacValue(params, hashKey, hashIV, alg) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

  let str = `HashKey=${hashKey}`;
  for (const k of keys) str += `&${k}=${params[k]}`;
  str += `&HashIV=${hashIV}`;

  // 等價 PHP urlencode：encodeURIComponent 不編碼 ~ 與 '，補上後整串轉小寫
  str = encodeURIComponent(str)
    .replace(/~/g, '%7e')
    .replace(/'/g, '%27')
    .toLowerCase()
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%20/g, '+');

  const h = alg === 'md5' ? crypto.createHash('md5') : crypto.createHash('sha256');
  return h.update(str).digest('hex').toUpperCase();
}

/**
 * 驗證 ECPay 回傳的 CheckMacValue
 */
function verifyCheckMacValue(params, hashKey, hashIV, alg) {
  const received = params.CheckMacValue || '';
  const expected = checkMacValue(params, hashKey, hashIV, alg);
  return received === expected;
}

/**
 * 組出送往綠界的付款參數（不含 CheckMacValue，由呼叫端補上）
 */
function buildOrderParams({ merchantId, orderId, amount, tradeDesc, itemName, returnUrl, clientBackUrl, alg, choosePayment }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    MerchantID: merchantId,
    MerchantTradeNo: orderId,
    MerchantTradeDate: date,
    PaymentType: 'aio',
    TotalAmount: String(amount),
    TradeDesc: tradeDesc,
    ItemName: itemName,
    ReturnURL: returnUrl,
    ClientBackURL: clientBackUrl,
    ChoosePayment: choosePayment || 'Credit',
    EncryptType: alg === 'md5' ? '0' : '1'
  };
}

module.exports = {
  DEFAULT_ACTION,
  checkMacValue,
  verifyCheckMacValue,
  buildOrderParams
};
