/**
 * 《董事會遊戲》v1 — 資料層（瀏覽器 + Node 共用）
 * 14 個董事會成員 + 7 關情境。遊戲引擎吃這份資料，結果卡也吃。
 *
 * 前台語言規則：
 *   - 對外只顯示董事會角色名與生活化描述
 *   - 不使用專業系統名稱、結果承諾或催促語言
 *   - 紅線：不抽卡、不機率。重玩必得 = 權重疊加解鎖
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZW_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STARS = [
    { key: 'ziwei',    role: '董事長',     tag: '掌握全局，做重要決定',      tone: '重視整體方向，也願意在關鍵時刻拍板。',                                      high: ['B1', 'B3'] },
    { key: 'tianji',   role: '策略長',     tag: '拆解問題，安排下一步',      tone: '反應快、點子多，習慣先想清楚再行動。',                                      high: ['B2', 'B4'] },
    { key: 'taiyang',  role: '公關長',     tag: '帶動氣氛，讓人願意靠近',    tone: '樂於連結他人，也會記得留一些時間給自己。',                                  high: ['B2', 'B1'] },
    { key: 'wuqu',     role: '執行長',     tag: '把事情推進到完成',          tone: '務實、行動力強，喜歡把計畫真正做出來。',                                    high: ['B1', 'B3', 'B4'] },
    { key: 'tiantong', role: '福委會主委', tag: '照顧關係，凝聚團隊',        tone: '溫和、容易和人合作，也需要替自己保留推進力。',                              high: ['B3', 'B1'] },
    { key: 'lianzhen', role: '風紀委員',   tag: '守住原則，要求品質',        tone: '自我要求高、重視細節，偶爾也容易對自己太嚴格。',                            high: ['B3', 'B1'] },
    { key: 'tianfu',   role: '財務長',     tag: '管理資源，準備長線',        tone: '穩健踏實，擅長把資源放在真正重要的地方。',                                  high: ['B1', 'B2'] },
    { key: 'taiyin',   role: '內務總管',   tag: '安靜觀察，感受細節',        tone: '感受力強、在乎品質，適合先想過再回應。',                                    high: ['B2', 'B3'] },
    { key: 'tanlang',  role: '業務總監',   tag: '開拓機會，帶來新連結',      tone: '好奇、擅長社交，適合把熱情收斂成可持續的行動。',                            high: ['B2', 'B4'] },
    { key: 'jumen',    role: '發言人',     tag: '看見問題，說出立場',        tone: '觀察細、表達直接，也要記得替關係留下空間。',                                high: ['B1', 'B3'] },
    { key: 'tianxiang',role: '法務長',     tag: '重視公平，協調不同意見',    tone: '善於理解不同立場，能幫團隊找到平衡。',                                      high: ['B3', 'B1'] },
    { key: 'tianliang',role: '顧問',       tag: '提供支持，安定人心',        tone: '願意照顧他人，也會用自己的節奏慢慢前進。',                                  high: ['B1', 'B4'] },
    { key: 'qisha',    role: '突擊隊長',   tag: '敢接挑戰，先行突破',        tone: '願意承擔風險，也會在壓力來時快速行動。',                                    high: ['B1', 'B4', 'B3'] },
    { key: 'pojun',    role: '改革派',     tag: '看見舊問題，推動改變',      tone: '不喜歡一成不變，習慣找出更好的做法。',                                      high: ['B1', 'B4'] }
  ];

  /* 四條血條：決策模式傾向，不是分數（0–100 為相對強度） */
  var BARS = [
    { key: 'B1', label: '攻守', high: '主動出擊', low: '防守退讓' },
    { key: 'B2', label: '內外', high: '外放張揚', low: '內斂藏鋒' },
    { key: 'B3', label: '剛柔', high: '果斷強硬', low: '圓融柔軟' },
    { key: 'B4', label: '快慢', high: '快速決策', low: '深思等待' }
  ];

  /* 7 關情境。每選項：stars 指向加分成員，bars 調整 4 血條。 */
  var QUESTIONS = [
    {
      id: 1, prompt: '會議上功勞被搶走，你的第一個念頭是？',
      options: [
        { key: 'a', label: '當場拍桌，把功勞討回來',       stars: { qisha: 3, wuqu: 1 },   bars: { B1: 2, B3: 1 } },
        { key: 'b', label: '先忍住，多數場合順著走',       stars: { tianfu: 3, tianxiang: 1 }, bars: { B1: -1, B3: -1 } },
        { key: 'c', label: '繞過他們，直接去找上面的人',   stars: { taiyang: 2, jumen: 2 },  bars: { B1: 1, B2: 1 } },
        { key: 'd', label: '先觀察是不是自己誤會了',       stars: { tianji: 3, taiyin: 1 },  bars: { B2: -1, B4: 1 } }
      ]
    },
    {
      id: 2, prompt: '對方已讀不回，你心裡跑出什麼？',
      options: [
        { key: 'a', label: '直接再追問，不讓事情模糊',     stars: { jumen: 3, qisha: 1 },   bars: { B1: 2, B3: 1 } },
        { key: 'b', label: '我是不是哪裡做得不夠好',       stars: { lianzhen: 3, taiyin: 1 }, bars: { B3: 1, B2: -1 } },
        { key: 'c', label: '隨緣，先把手邊的事做完',       stars: { tiantong: 3, tianliang: 1 }, bars: { B1: -1, B3: -1 } },
        { key: 'd', label: '先找朋友聊聊，再決定怎麼辦',   stars: { taiyang: 2, tianliang: 2 }, bars: { B2: 1, B4: 1 } }
      ]
    },
    {
      id: 3, prompt: '被逼表態：「你現在就要站隊」，你？',
      options: [
        { key: 'a', label: '站就站，我選對邊',             stars: { qisha: 2, wuqu: 2 },   bars: { B1: 1, B4: 1 } },
        { key: 'b', label: '講道理，兩邊都不得罪',         stars: { tianxiang: 3, tianji: 1 }, bars: { B3: -1, B4: 1 } },
        { key: 'c', label: '用拖的，拖到大家都想清楚',     stars: { taiyin: 3, tianliang: 1 }, bars: { B2: -1, B4: 1 } },
        { key: 'd', label: '反過來質問他們憑什麼逼我',     stars: { lianzhen: 3, jumen: 1 }, bars: { B3: 2 } }
      ]
    },
    {
      id: 4, prompt: '機會突然降臨，你有三天決定，你？',
      options: [
        { key: 'a', label: '先接了再說，船到橋頭自然直',   stars: { tanlang: 3, pojun: 1 }, bars: { B2: 1, B4: 1 } },
        { key: 'b', label: '熬夜把利弊全想過一遍',         stars: { tianji: 3, lianzhen: 1 }, bars: { B4: 2 } },
        { key: 'c', label: '找信任的人問一圈',             stars: { tianliang: 2, taiyang: 2 }, bars: { B2: 1, B4: -1 } },
        { key: 'd', label: '看誰搶得過我，直接下手',       stars: { qisha: 2, wuqu: 2 },   bars: { B1: 2, B4: 1 } }
      ]
    },
    {
      id: 5, prompt: '朋友借錢，你，說「沒問題」，還是？',
      options: [
        { key: 'a', label: '借，當場談清楚還款時間',       stars: { wuqu: 3, tianxiang: 1 }, bars: { B1: 1, B3: -1 } },
        { key: 'b', label: '不好意思拒絕，先借他',          stars: { tiantong: 3, taiyin: 1 }, bars: { B3: -2 } },
        { key: 'c', label: '直接拒絕，救急不救窮',          stars: { jumen: 3, lianzhen: 1 }, bars: { B1: 2 } },
        { key: 'd', label: '先問清楚用途再決定',          stars: { tianji: 3, tianfu: 1 }, bars: { B4: 1 } }
      ]
    },
    {
      id: 6, prompt: '形象翻車了（說錯話被截圖），你？',
      options: [
        { key: 'a', label: '馬上澄清，講到我被聽見',       stars: { taiyang: 3, jumen: 1 }, bars: { B1: 1, B2: 1 } },
        { key: 'b', label: '先安靜，等風波過去再說',       stars: { taiyin: 3, tianliang: 1 }, bars: { B2: -2 } },
        { key: 'c', label: '自嘲帶過，我最會自黑',         stars: { tanlang: 3, tiantong: 1 }, bars: { B2: 1, B3: -1 } },
        { key: 'd', label: '算帳，是誰在背後弄我',         stars: { qisha: 3, lianzhen: 1 }, bars: { B1: 2, B3: 1 } }
      ]
    },
    {
      id: 7, prompt: '人生最想突破的一步，你發現自己最常被什麼拉住？',
      options: [
        { key: 'a', label: '別人眼光',                     stars: { taiyang: 3, taiyin: 1 }, bars: { B2: 2 } },
        { key: 'b', label: '自己太衝，做錯決定',            stars: { lianzhen: 3, qisha: 1 }, bars: { B3: 1, B1: -1 } },
        { key: 'c', label: '太安於現狀，不敢跨',            stars: { tianliang: 3, tiantong: 1 }, bars: { B4: -1, B1: -1 } },
        { key: 'd', label: '太想做太多事，卻不深入',        stars: { tanlang: 3, tianji: 1 }, bars: { B2: 1, B4: 1 } }
      ]
    }
  ];

  return { STARS: STARS, BARS: BARS, QUESTIONS: QUESTIONS };
});
