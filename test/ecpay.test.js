'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ecpay = require('../lib/ecpay.js');

const KEY = '5294y06JbISpM5x9';
const IV = 'v77hoKGq4kWxNNIS';

test('CheckMacValue 為 64 位大寫 hex（SHA256）且可重現', () => {
  const params = {
    MerchantID: '2000132',
    MerchantTradeNo: 'KC20260816120000123',
    TotalAmount: '499',
    TradeDesc: '第一印象被低估報告',
    ItemName: '完整第一印象報告',
    ReturnURL: 'https://example.com/api/pay-callback',
    ChoosePayment: 'Credit'
  };
  const a = ecpay.checkMacValue(params, KEY, IV, 'sha256');
  const b = ecpay.checkMacValue(params, KEY, IV, 'sha256');
  assert.strictEqual(a, b, '同輸入應得同結果');
  assert.match(a, /^[0-9A-F]{64}$/, 'SHA256 應為 64 位大寫 hex');
});

test('MD5 模式為 32 位大寫 hex', () => {
  const params = { MerchantID: '2000132', TotalAmount: '499' };
  const v = ecpay.checkMacValue(params, KEY, IV, 'md5');
  assert.match(v, /^[0-9A-F]{32}$/);
});

test('驗證通過：正確簽章', () => {
  const params = {
    MerchantID: '2000132',
    MerchantTradeNo: 'KC20260816120000123',
    RtnCode: '1',
    TotalAmount: '499',
    TradeNo: '1234567890'
  };
  params.CheckMacValue = ecpay.checkMacValue(params, KEY, IV, 'sha256');
  assert.ok(ecpay.verifyCheckMacValue(params, KEY, IV, 'sha256'));
});

test('驗證失敗：簽章被竄改', () => {
  const params = {
    MerchantID: '2000132',
    MerchantTradeNo: 'KC20260816120000123',
    RtnCode: '1',
    TotalAmount: '499'
  };
  params.CheckMacValue = ecpay.checkMacValue(params, KEY, IV, 'sha256');
  params.TotalAmount = '1'; // 竄改金額
  assert.ok(!ecpay.verifyCheckMacValue(params, KEY, IV, 'sha256'));
});

test('與綠界官方文件範例完全一致（SHA256）', () => {
  // 官方「檢查碼機制說明」工作範例
  const params = {
    TradeDesc: '促銷方案',
    PaymentType: 'aio',
    MerchantTradeDate: '2023/03/12 15:30:23',
    MerchantTradeNo: 'ecpay20230312153023',
    MerchantID: '3002607',
    ReturnURL: 'https://www.ecpay.com.tw/receive.php',
    ItemName: 'Apple iphone 15',
    TotalAmount: '30000',
    ChoosePayment: 'ALL',
    EncryptType: '1'
  };
  const got = ecpay.checkMacValue(params, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs', 'sha256');
  assert.strictEqual(got, '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840');
});

test('buildOrderParams 含必要欄位且金額正確', () => {
  const p = ecpay.buildOrderParams({
    merchantId: '2000132',
    orderId: 'KC20260816120000123',
    amount: 499,
    tradeDesc: '第一印象被低估報告',
    itemName: '完整第一印象報告',
    returnUrl: 'https://example.com/api/pay-callback',
    clientBackUrl: 'https://example.com/quiz/success.html?order=KC20260816120000123',
    alg: 'sha256'
  });
  assert.strictEqual(p.TotalAmount, '499');
  assert.strictEqual(p.ChoosePayment, 'Credit');
  assert.strictEqual(p.EncryptType, '1');
  assert.match(p.MerchantTradeDate, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
});
