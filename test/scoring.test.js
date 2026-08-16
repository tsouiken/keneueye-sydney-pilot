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
