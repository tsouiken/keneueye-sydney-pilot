/**
 * KenEyeCue 第一印象被低估測驗 — 共用邏輯
 * 瀏覽器（window.QuizLogic）與 Node（module.exports）共用。
 *
 * 5 種被誤讀的第一印象（品牌既有語彙）：
 *   fierce    太兇   → 被低估：親和力
 *   tired     太累   → 被低估：狀態與精神
 *   soft      太軟   → 被低估：專業份量
 *   scattered 太散   → 被低估：可靠度
 *   hard      太硬   → 被低估：溫度與彈性
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIMENSIONS = ['fierce', 'tired', 'soft', 'scattered', 'hard'];

  // 平手時的優先序：專業份量（太軟）為旗艦結果，排最前
  var PRIORITY = ['soft', 'scattered', 'fierce', 'tired', 'hard'];

  var QUESTIONS = [
    {
      id: 'q1',
      text: '第一次見面的人，最常怎麼形容你？',
      options: [
        { label: '看起來不好親近', dim: 'fierce' },
        { label: '看起來沒睡飽', dim: 'tired' },
        { label: '看起來很好說話', dim: 'soft' },
        { label: '看起來心不在焉', dim: 'scattered' },
        { label: '看起來一板一眼', dim: 'hard' }
      ]
    },
    {
      id: 'q2',
      text: '你覺得自己的眉眼，給人的直覺是？',
      options: [
        { label: '眼神比較銳利', dim: 'fierce' },
        { label: '眼神比較無神', dim: 'tired' },
        { label: '眉型比較柔和', dim: 'soft' },
        { label: '眉毛比較稀疏', dim: 'scattered' },
        { label: '眉型比較平直', dim: 'hard' }
      ]
    },
    {
      id: 'q3',
      text: '在面試、提案、初次見面這類場合，你最常被誤會的是？',
      options: [
        { label: '在生氣或不耐煩', dim: 'fierce' },
        { label: '沒精神、不重視', dim: 'tired' },
        { label: '沒主見、好欺負', dim: 'soft' },
        { label: '不專心、不可靠', dim: 'scattered' },
        { label: '太嚴肅、難溝通', dim: 'hard' }
      ]
    },
    {
      id: 'q4',
      text: '你覺得自己真實的樣子，和別人看到的你，落差在哪？',
      options: [
        { label: '我其實很友善，但常被覺得有距離', dim: 'fierce' },
        { label: '我其實很有精神，但常被覺得很累', dim: 'tired' },
        { label: '我其實很有主見，但常被覺得好說話', dim: 'soft' },
        { label: '我其實很專注，但常被覺得心不在焉', dim: 'scattered' },
        { label: '我其實很隨和，但常被覺得很嚴肅', dim: 'hard' }
      ]
    },
    {
      id: 'q5',
      text: '如果只能改一件事，你最想讓別人第一眼看到你時，感受到什麼？',
      options: [
        { label: '好親近', dim: 'fierce' },
        { label: '有精神', dim: 'tired' },
        { label: '有份量', dim: 'soft' },
        { label: '很可靠', dim: 'scattered' },
        { label: '有溫度', dim: 'hard' }
      ]
    }
  ];

  var RESULTS = {
    fierce: {
      dim: 'fierce',
      title: '親和力',
      line: '你目前最可能被低估的是：親和力。',
      desc: '你的眉眼線條偏銳利，第一次見面的人容易先讀到距離感，而忽略你其實很好相處。',
      note: '這不代表你「看起來兇」，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    tired: {
      dim: 'tired',
      title: '狀態與精神',
      line: '你目前最可能被低估的是：狀態與精神。',
      desc: '你的眉眼容易給人沒睡飽的直覺，別人會先注意到疲態，而忽略你實際的投入。',
      note: '這不代表你真的累，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    soft: {
      dim: 'soft',
      title: '專業份量',
      line: '你目前最可能被低估的是：專業份量。',
      desc: '你的眉型偏柔和，第一次見面的人容易先讀到好說話，而忽略你真正的專業與主見。',
      note: '這不代表你「看起來軟」，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    scattered: {
      dim: 'scattered',
      title: '可靠度',
      line: '你目前最可能被低估的是：可靠度。',
      desc: '你的眉眼給人比較渙散的直覺，別人容易先懷疑你專不專注，而忽略你其實很可靠。',
      note: '這不代表你不專注，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    hard: {
      dim: 'hard',
      title: '溫度與彈性',
      line: '你目前最可能被低估的是：溫度與彈性。',
      desc: '你的眉型偏平直，別人容易先讀到嚴肅，而忽略你其實隨和、有彈性。',
      note: '這不代表你「看起來硬」，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    }
  };

  /**
   * 計分：answers 為長度 5 的陣列，每項是選項的 dim。
   * 回傳 { dim, title, line, desc, note, counts }
   */
  function score(answers) {
    var counts = {};
    DIMENSIONS.forEach(function (d) { counts[d] = 0; });
    answers.forEach(function (d) { if (counts[d] !== undefined) counts[d] += 1; });

    var best = PRIORITY[0];
    for (var i = 1; i < PRIORITY.length; i++) {
      if (counts[PRIORITY[i]] > counts[best]) best = PRIORITY[i];
    }
    var r = RESULTS[best];
    return { dim: r.dim, title: r.title, line: r.line, desc: r.desc, note: r.note, counts: counts };
  }

  return {
    DIMENSIONS: DIMENSIONS,
    PRIORITY: PRIORITY,
    QUESTIONS: QUESTIONS,
    RESULTS: RESULTS,
    score: score
  };
});
