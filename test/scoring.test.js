'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../quiz/quiz-logic.js');
const { STARS, BARS, QUESTIONS } = Logic;

test('資料完整性：14 位成員、4 血條、7 關', () => {
  assert.strictEqual(STARS.length, 14);
  assert.strictEqual(BARS.length, 4);
  assert.strictEqual(QUESTIONS.length, 7);
  assert.deepStrictEqual(BARS.map(b => b.key), ['B1', 'B2', 'B3', 'B4']);
});

test('每關 4 個選項，皆含 key、stars、bars', () => {
  const starKeys = new Set(STARS.map(s => s.key));
  const barKeys = new Set(BARS.map(b => b.key));
  for (const q of QUESTIONS) {
    assert.strictEqual(q.options.length, 4, `第 ${q.id} 關應有 4 選項`);
    for (const o of q.options) {
      assert.ok(o.key, `第 ${q.id} 關選項缺 key`);
      assert.ok(o.stars && Object.keys(o.stars).length > 0, `第 ${q.id} 關選項缺 stars`);
      for (const k of Object.keys(o.stars)) {
        assert.ok(starKeys.has(k), `第 ${q.id} 關 stars 引用了不存在的成員 ${k}`);
      }
      assert.ok(o.bars && Object.keys(o.bars).length > 0, `第 ${q.id} 關選項缺 bars`);
      for (const k of Object.keys(o.bars)) {
        assert.ok(barKeys.has(k), `第 ${q.id} 關 bars 引用了不存在的血條 ${k}`);
      }
    }
  }
});

test('計分：7 題作答回傳權力核心、血條、解鎖', () => {
  const r = Logic.run(['a', 'd', 'b', 'c', 'a', 'b', 'd']);
  assert.strictEqual(r.top.length, 3);
  assert.ok(r.top[0].key);
  assert.strictEqual(r.ranking.length, 14);
  assert.deepStrictEqual(r.unlocked, r.top.map(s => s.key));
  assert.strictEqual(r.locked.length, 11);
  // 血條為 0–100 的相對強度
  for (const k of Object.keys(r.bars)) {
    assert.ok(r.bars[k] >= 0 && r.bars[k] <= 100, `${k} 應在 0–100`);
  }
});

test('重玩必得：不同選擇產生不同董事會', () => {
  const ra = Logic.run(['a', 'a', 'a', 'a', 'a', 'a', 'a']);
  const rb = Logic.run(['b', 'b', 'b', 'b', 'b', 'b', 'b']);
  const ka = ra.top.map(s => s.key).join(',');
  const kb = rb.top.map(s => s.key).join(',');
  assert.notStrictEqual(ka, kb, '全選 a 與全選 b 的董事會應不同');
  // 同一組答案重跑結果一致（無隨機）
  const ra2 = Logic.run(['a', 'a', 'a', 'a', 'a', 'a', 'a']);
  assert.deepStrictEqual(ra.top.map(s => s.key), ra2.top.map(s => s.key));
});

test('品牌閘門：對外文案零命理術語、零效果保證', () => {
  const banned = ['紫微', '七殺', '破軍', '主星', '宮位', '流年', '命盤', '八字', '保證', '一定', '注定', '100%', '招財', '桃花'];
  // 對外欄位：role、tag、tone、血條 label/high/low
  const publicText = [
    ...STARS.flatMap(s => [s.role, s.tag, s.tone]),
    ...BARS.flatMap(b => [b.label, b.high, b.low]),
    ...QUESTIONS.map(q => q.prompt),
    ...QUESTIONS.flatMap(q => q.options.map(o => o.label))
  ].join(' ');
  for (const b of banned) {
    assert.ok(!publicText.includes(b), `對外文案不得包含「${b}」`);
  }
});
