'use strict';
const test = require('node:test');
const assert = require('node:assert');
const QuizLogic = require('../quiz/quiz-logic.js');

test('5 題作答，各維度獨立計分', () => {
  const cases = {
    fierce: ['fierce', 'fierce', 'fierce', 'fierce', 'fierce'],
    tired: ['tired', 'tired', 'tired', 'tired', 'tired'],
    soft: ['soft', 'soft', 'soft', 'soft', 'soft'],
    scattered: ['scattered', 'scattered', 'scattered', 'scattered', 'scattered'],
    hard: ['hard', 'hard', 'hard', 'hard', 'hard']
  };
  for (const [dim, answers] of Object.entries(cases)) {
    const r = QuizLogic.score(answers);
    assert.strictEqual(r.dim, dim, `全部選 ${dim} 應得 ${dim}`);
  }
});

test('平手時依優先序：soft > scattered > fierce > tired > hard', () => {
  // soft 2 票、scattered 2 票、fierce 1 票 → soft 勝
  const r = QuizLogic.score(['soft', 'scattered', 'soft', 'scattered', 'fierce']);
  assert.strictEqual(r.dim, 'soft');
  // scattered 2、fierce 2、soft 1 → scattered 勝
  const r2 = QuizLogic.score(['scattered', 'fierce', 'scattered', 'fierce', 'soft']);
  assert.strictEqual(r2.dim, 'scattered');
});

test('結果包含標題、說明與注意事項，且無命理術語', () => {
  const r = QuizLogic.score(['soft', 'soft', 'soft', 'soft', 'soft']);
  assert.ok(r.title.length > 0);
  assert.ok(r.line.includes('被低估'));
  assert.ok(r.desc.length > 0);
  assert.ok(r.note.length > 0);
  const banned = ['紫微', '八字', '流年', '宮位', '主星', '保證', '一定', '注定', '100%', '招財', '桃花'];
  const all = (r.line + r.desc + r.note);
  for (const b of banned) {
    assert.ok(!all.includes(b), `結果不得包含「${b}」`);
  }
});

test('每題 5 個選項，各對應一個有效維度', () => {
  assert.strictEqual(QuizLogic.QUESTIONS.length, 5);
  for (const q of QuizLogic.QUESTIONS) {
    assert.strictEqual(q.options.length, 5);
    for (const o of q.options) {
      assert.ok(QuizLogic.DIMENSIONS.includes(o.dim), `${q.id} 選項維度 ${o.dim} 無效`);
    }
  }
});

test('每個維度都有加厚後的結果欄位', () => {
  for (const dim of QuizLogic.DIMENSIONS) {
    const r = QuizLogic.RESULTS[dim];
    assert.ok(r.reading && r.reading.length > 20, `${dim} 缺少 reading`);
    assert.ok(r.truth && r.truth.length > 20, `${dim} 缺少 truth`);
    assert.ok(r.shareLine && r.shareLine.length > 0, `${dim} 缺少 shareLine`);
    assert.ok(Array.isArray(r.cost) && r.cost.length >= 2, `${dim} 的 cost 至少要兩項`);
    for (const c of r.cost) {
      assert.ok(typeof c === 'string' && c.length > 0, `${dim} 的 cost 有空項目`);
    }
  }
});

test('score() 會把加厚欄位帶出來', () => {
  const r = QuizLogic.score(['hard', 'hard', 'hard', 'hard', 'hard']);
  assert.strictEqual(r.dim, 'hard');
  assert.ok(r.reading.length > 0);
  assert.ok(r.truth.length > 0);
  assert.ok(r.shareLine.length > 0);
  assert.ok(Array.isArray(r.cost) && r.cost.length >= 2);
});

test('score() 回傳的 cost 是複本，改它不會汙染 RESULTS', () => {
  const r = QuizLogic.score(['fierce', 'fierce', 'fierce', 'fierce', 'fierce']);
  const before = QuizLogic.RESULTS.fierce.cost.length;
  r.cost.push('外部竄改');
  assert.strictEqual(QuizLogic.RESULTS.fierce.cost.length, before);
});

test('加厚後的全部文案仍不得出現命理術語或神準敘事', () => {
  // 「神準／預測／命中」是這波韓國算命熱潮翻車的那一塊，品牌立場明確不跟
  const banned = [
    '紫微', '八字', '流年', '宮位', '主星',
    '保證', '一定', '注定', '100%', '招財', '桃花',
    '神準', '預測', '命中', '預言'
  ];
  for (const dim of QuizLogic.DIMENSIONS) {
    const r = QuizLogic.RESULTS[dim];
    const all = [r.line, r.desc, r.reading, r.truth, r.shareLine, r.note].concat(r.cost).join('');
    for (const b of banned) {
      assert.ok(!all.includes(b), `${dim} 的結果文案不得包含「${b}」`);
    }
  }
});
