/**
 * 董事會遊戲 — 四個互動訊號埋點
 * 二次遊玩 / 分享 / PK / CTA 點擊。v1 先落 localStorage，後端可再轉送自有後台。
 */
(function (root) {
  'use strict';

  function uid() {
    var k = 'zw_uid';
    var v = null;
    try { v = localStorage.getItem(k); } catch (_) {}
    if (!v) {
      v = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(k, v); } catch (_) {}
    }
    return v;
  }

  function track(evt, data) {
    data = data || {};
    var row = {
      evt: evt,
      uid: uid(),
      ts: new Date().toISOString(),
      session: null
    };
    Object.keys(data).forEach(function (k) { row[k] = data[k]; });

    // session 記錄：同一天算一次遊玩
    var dayKey = 'zw_day_' + new Date().toISOString().slice(0, 10);
    try {
      if (!localStorage.getItem(dayKey)) {
        localStorage.setItem(dayKey, '1');
        row.session = 'new';
      } else {
        row.session = 'repeat';
      }
    } catch (_) { row.session = 'unknown'; }

    // 事件累計（供除錯與後續接後端）
    try {
      var arr = JSON.parse(localStorage.getItem('zw_events') || '[]');
      arr.push(row);
      if (arr.length > 500) arr = arr.slice(-500);
      localStorage.setItem('zw_events', JSON.stringify(arr));
    } catch (_) {}

    if (root.console && root.console.info) root.console.info('[zw]', evt, data);
  }

  root.track = track;
})(typeof self !== 'undefined' ? self : this);
