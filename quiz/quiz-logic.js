/**
 * 《董事會遊戲》— 計分共用引擎（瀏覽器 + Node 共用）
 *
 * 輸入：7 關選擇（option key 或索引）
 * 輸出：14 位成員權重、四條血條（0–100 相對強度）、董事會權力核心前 3、解鎖清單
 *
 * 規則：
 *   - 血條是「決策模式傾向」，不是分數；結果卡只呈現權力分布
 *   - 平手時以「該成員的傾向血條」在當前結果中的強度排序，再平手依資料順序
 *   - 不抽卡、不機率：解鎖 = 權重疊加，重玩必得
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./quiz-data.js'));
  } else {
    root.QuizLogic = factory(root.ZW_DATA);
  }
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';

  var STARS = DATA.STARS;
  var BARS = DATA.BARS;
  var QUESTIONS = DATA.QUESTIONS;
  var BAR_KEYS = BARS.map(function (b) { return b.key; });

  /**
   * 計分：answers 為長度 7 的陣列，每項是 option.key（或該關選項索引）。
   * 回傳：
   *   { top, ranking, weights, bars, unlocked, locked }
   */
  function run(answers) {
    var weights = {};
    var raw = {};
    STARS.forEach(function (s) { weights[s.key] = 0; });
    BAR_KEYS.forEach(function (k) { raw[k] = 0; });

    answers.forEach(function (ans, i) {
      var q = QUESTIONS[i];
      if (!q) return;
      var opt = q.options.find(function (o) { return o.key === ans; });
      if (!opt && typeof ans === 'number') opt = q.options[ans];
      if (!opt) return;
      Object.keys(opt.stars || {}).forEach(function (k) {
        weights[k] = (weights[k] || 0) + opt.stars[k];
      });
      Object.keys(opt.bars || {}).forEach(function (k) {
        raw[k] = (raw[k] || 0) + opt.bars[k];
      });
    });

    // 血條正規化：跨 4 條做 min–max 到 0–100（呈現相對強度）
    var bars = {};
    var lo = Math.min.apply(null, BAR_KEYS.map(function (k) { return raw[k]; }));
    var hi = Math.max.apply(null, BAR_KEYS.map(function (k) { return raw[k]; }));
    BAR_KEYS.forEach(function (k) {
      bars[k] = hi === lo ? 50 : Math.round((raw[k] - lo) / (hi - lo) * 100);
    });

    // 排序：權重 desc → 傾向血條強度 → 資料順序（穩定、無隨機）
    function tendencyStrength(s) {
      return (s.high || []).reduce(function (acc, k) { return acc + raw[k]; }, 0);
    }
    var ranking = STARS.slice().sort(function (a, b) {
      if (weights[b.key] !== weights[a.key]) return weights[b.key] - weights[a.key];
      if (tendencyStrength(b) !== tendencyStrength(a)) return tendencyStrength(b) - tendencyStrength(a);
      return STARS.indexOf(a) - STARS.indexOf(b);
    });

    var top = ranking.slice(0, 3).map(function (s) { return s; });
    var unlocked = top.map(function (s) { return s.key; });

    return {
      top: top,
      ranking: ranking,
      weights: weights,
      bars: bars,
      unlocked: unlocked,
      locked: STARS.map(function (s) { return s.key; }).filter(function (k) { return unlocked.indexOf(k) === -1; })
    };
  }

  return {
    STARS: STARS,
    BARS: BARS,
    QUESTIONS: QUESTIONS,
    run: run
  };
});
