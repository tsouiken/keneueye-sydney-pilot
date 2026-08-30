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
      reading: '在對方還沒聽你說話之前，眉峰和眼神的線條已經先送出一個「不太好靠近」的訊號。這個訊號比你的語氣更早抵達。',
      cost: [
        '第一次帶新客戶或新同事時，對方會先客氣、後保留',
        '團隊裡別人有事，不會第一個想到找你商量',
        '服務或銷售場合，對方會下意識縮短停留時間'
      ],
      truth: '你多半是願意把話講清楚、也願意幫忙的人。落差不在個性，而在於別人沒機會走到那一步。',
      shareLine: '我的親和力，常常在開口前就被誤讀了。',
      note: '這不代表你「看起來兇」，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    tired: {
      dim: 'tired',
      title: '狀態與精神',
      line: '你目前最可能被低估的是：狀態與精神。',
      desc: '你的眉眼容易給人沒睡飽的直覺，別人會先注意到疲態，而忽略你實際的投入。',
      reading: '眼周的線條會先被讀成疲態，於是對方接收到的第一個訊息不是你的想法，而是你的狀態。',
      cost: [
        '提案或面試時，容易被解讀成準備不足',
        '需要展現投入度的場合，說服力被打折',
        '長時間會議裡，別人會誤判你已經沒在跟'
      ],
      truth: '你多半是撐得住、也真的有在投入的人。被扣分的是外顯訊號，不是你的專注度。',
      shareLine: '我不是沒精神，是我的眼睛先幫我講了別的話。',
      note: '這不代表你真的累，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    soft: {
      dim: 'soft',
      title: '專業份量',
      line: '你目前最可能被低估的是：專業份量。',
      desc: '你的眉型偏柔和，第一次見面的人容易先讀到好說話，而忽略你真正的專業與主見。',
      reading: '眉型偏柔和時，對方會先把你歸類成「好溝通」。而「好溝通」在談判桌上，常常被翻譯成「好推動」。',
      cost: [
        '報價或談條件時，對方預期你會讓步',
        '會議裡你的意見要講第二次才被聽見',
        '資歷相近時，主導權容易被旁邊的人拿走'
      ],
      truth: '你多半是有判斷、也守得住底線的人。只是你的臉沒有幫你先把這件事說出來。',
      shareLine: '我的專業份量，總要等到第二次見面才被看見。',
      note: '這不代表你「看起來軟」，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    scattered: {
      dim: 'scattered',
      title: '可靠度',
      line: '你目前最可能被低估的是：可靠度。',
      desc: '你的眉眼給人比較渙散的直覺，別人容易先懷疑你專不專注，而忽略你其實很可靠。',
      reading: '眉毛較稀疏或線條較散時，第一眼傳出去的是注意力沒有集中，於是對方會先評估你可不可靠，而不是你會不會做。',
      cost: [
        '交付重要案子前，對方會多問幾次確認',
        '第一次合作時容易被安排在協助的位置',
        '需要立刻建立信任的場合，前段要耗比較久'
      ],
      truth: '你多半是會把事情做完、也記得細節的人。要補的是第一眼的穩定感，不是你的能力。',
      shareLine: '我的可靠度，第一眼常常沒被算進去。',
      note: '這不代表你不專注，而是眉眼結構發出的訊號，和你想傳遞的訊息之間有落差。'
    },
    hard: {
      dim: 'hard',
      title: '溫度與彈性',
      line: '你目前最可能被低估的是：溫度與彈性。',
      desc: '你的眉型偏平直，別人容易先讀到嚴肅，而忽略你其實隨和、有彈性。',
      reading: '眉型偏平直時，表情的起伏會被讀得比實際小，於是對方先接收到嚴肅，才有機會發現你其實很好聊。',
      cost: [
        '初次見面時對方會過度謹慎、不敢開玩笑',
        '需要拉近距離的場合，暖場時間被拉長',
        '帶人或協作時，別人不確定你能不能商量'
      ],
      truth: '你多半是隨和、也願意調整的人。只是你的預設表情比你的個性嚴格。',
      shareLine: '我的溫度，常常被我的眉型擋在外面。',
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
    return {
      dim: r.dim,
      title: r.title,
      line: r.line,
      desc: r.desc,
      reading: r.reading,
      cost: r.cost.slice(),
      truth: r.truth,
      shareLine: r.shareLine,
      note: r.note,
      counts: counts
    };
  }

  return {
    DIMENSIONS: DIMENSIONS,
    PRIORITY: PRIORITY,
    QUESTIONS: QUESTIONS,
    RESULTS: RESULTS,
    score: score
  };
});
