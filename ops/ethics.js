/**
 * KenEyeCue Ethics & Safety Components — Section 21
 * All components are self-contained and require no external dependencies.
 */

/* ─── Shared utilities ─── */

function _injectCSS(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

function _modal(html, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'ethics-overlay';
  overlay.innerHTML = `<div class="ethics-modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.ethics-close')?.addEventListener('click', () => {
    overlay.remove();
    if (onClose) onClose();
  });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { overlay.remove(); if (onClose) onClose(); }
  });
  overlay.querySelector('.ethics-modal')?.focus();
  return overlay;
}

_injectCSS('ethics-base-css', `
  .ethics-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  .ethics-modal {
    background: #fff; border-radius: 12px; padding: 28px 32px; max-width: 520px;
    width: 100%; max-height: 90vh; overflow-y: auto; outline: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .ethics-modal h3 { margin: 0 0 12px; font-size: 1.1rem; color: #1a1a1a; }
  .ethics-modal p  { margin: 0 0 12px; font-size: .9rem; line-height: 1.6; color: #444; }
  .ethics-modal ul { margin: 0 0 12px; padding-left: 20px; font-size: .9rem; color: #444; line-height: 1.6; }
  .ethics-close {
    display: inline-block; margin-top: 12px; padding: 8px 20px;
    background: #1a1a1a; color: #fff; border: none; border-radius: 6px;
    cursor: pointer; font-size: .875rem;
  }
  .ethics-close:hover { background: #333; }
  .ethics-close.secondary {
    background: #f0f0f0; color: #333; margin-right: 8px;
  }
  .ethics-close.secondary:hover { background: #e0e0e0; }
  .ethics-risk-high  { border-left: 4px solid #d32f2f; padding-left: 16px; }
  .ethics-risk-mid   { border-left: 4px solid #f57c00; padding-left: 16px; }
  .ethics-disclaimer-block {
    background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 14px 18px; margin-top: 24px; font-size: .8rem; color: #666;
    line-height: 1.6;
  }
  .ethics-disclaimer-block + .ethics-disclaimer-block { margin-top: 10px; }
`);

/* ─────────────────────────────────────────────
   EthicsDisclaimer — standard footer disclaimer (21.12)
   Usage: EthicsDisclaimer.inject(containerEl, 'general' | 'third-party' | 'high-risk')
   ───────────────────────────────────────────── */
const EthicsDisclaimer = {
  texts: {
    general: `本分析是溝通輔助，不是人格診斷、命定預測或對他人的事實判定。系統可能根據你提供的資料產生推測，請以實際互動、直接溝通與對方明確表達為準。請勿將分析用於操控、欺騙、監控、歧視或重大決策。`,
    'third-party': `你提供的可能是第三人的個人資料。請只輸入完成當前任務所需的最少資訊，並確認你有適當權限或已取得對方同意。你可以改用代稱、模糊化資料或不使用出生資料的模式。`,
    'high-risk': `這個情境可能涉及人身安全、重大權益或專業判斷。系統無法取代緊急服務、醫療、法律或心理專業協助。若有立即危險，請優先聯繫當地緊急服務或可信任的專業機構。`
  },

  inject(containerEl, type = 'general') {
    const text = this.texts[type] || this.texts.general;
    const div = document.createElement('div');
    div.className = 'ethics-disclaimer-block';
    div.setAttribute('role', 'note');
    div.textContent = text;
    containerEl.appendChild(div);
    return div;
  },

  injectAll(containerEl, types = ['general']) {
    types.forEach(t => this.inject(containerEl, t));
  }
};

/* ─────────────────────────────────────────────
   ThirdPartyWarning — modal when user inputs third-party data (21.2.6)
   Usage: ThirdPartyWarning.show(onContinue)
   ───────────────────────────────────────────── */
const ThirdPartyWarning = {
  _shown: false,

  show(onContinue) {
    if (this._shown) { if (onContinue) onContinue(); return; }
    const html = `
      <h3>⚠️ 第三人資料提醒</h3>
      <p>你即將輸入的可能是第三人（非你本人）的個人資料，包括出生資料、聊天內容、關係描述或其他可識別資訊。</p>
      <p>請確認以下事項後再繼續：</p>
      <ul>
        <li>只輸入完成當前任務所需的<strong>最少資料</strong>。</li>
        <li>你有適當的授權，或已取得對方同意。</li>
        <li>所提供資料不會被用於操控、監控、歧視或重大決策。</li>
        <li>可以用代稱取代真實姓名，用概略資料取代精確資訊。</li>
      </ul>
      <button class="ethics-close secondary" id="ethics-third-party-cancel">取消</button>
      <button class="ethics-close" id="ethics-third-party-ok">我了解，繼續</button>
    `;
    const overlay = _modal(html, null);
    overlay.querySelector('#ethics-third-party-ok').addEventListener('click', () => {
      this._shown = true;
      overlay.remove();
      if (onContinue) onContinue();
    });
    overlay.querySelector('#ethics-third-party-cancel').addEventListener('click', () => {
      overlay.remove();
    });
  },

  reset() { this._shown = false; }
};

/* ─────────────────────────────────────────────
   RiskGate — keyword-based risk detection & modal (21.8)
   Usage: RiskGate.check(inputText) → 'low' | 'medium' | 'high'
          RiskGate.gate(inputText, onLowRisk, onHighOrMedium)
   ───────────────────────────────────────────── */
const RiskGate = {
  highKeywords: [
    '自傷', '自殺', '傷害自己', '結束生命', '不想活', '我想死',
    '家暴', '性暴力', '強姦', '強姦', '跟蹤', '跟踪', '威脅',
    '未成年', '小孩', '兒童', '誘導', '性剝削',
    '勒索', '強迫', '隔離', '控制他', '監控', '破解帳號', '定位她', '定位他',
    '投資決策', '借貸', '重大金錢', '移民', '法律決策', '醫療決策'
  ],
  mediumKeywords: [
    '分手', '拒絕', '衝突', '吵架', '冷戰', '不理我', '焦慮', '依賴',
    '報復', '冷暴力', '逼他', '逼她', '金錢協商', '職場', '壓力',
    '追蹤行為', '反覆', '一直傳', '試探', '吃醋', '嫉妒'
  ],
  manipulationKeywords: [
    '弱點', '讓他離不開', '套出', '控制他', '讓她害怕', '讓他焦慮',
    '情緒勒索', '逼他答應', '利用他', '利用她', '操控'
  ],

  safetyResources: `
    <ul>
      <li>🆘 <strong>緊急服務</strong>：000（澳洲）</li>
      <li>💜 <strong>家暴熱線</strong>：1800 RESPECT（1800 737 732）</li>
      <li>💛 <strong>心理危機</strong>：Lifeline 13 11 14</li>
      <li>🧒 <strong>兒少保護</strong>：Child Protection Helpline 132 111</li>
      <li>🌐 <strong>法律援助</strong>：Legal Aid NSW 1300 888 529</li>
    </ul>
  `,

  _match(text, keywords) {
    const t = text.toLowerCase();
    return keywords.some(k => t.includes(k.toLowerCase()));
  },

  check(text) {
    if (this._match(text, this.highKeywords) || this._match(text, this.manipulationKeywords)) return 'high';
    if (this._match(text, this.mediumKeywords)) return 'medium';
    return 'low';
  },

  showHighRiskModal(onClose) {
    const html = `
      <div class="ethics-risk-high">
        <h3>🚨 這個情境可能涉及人身安全</h3>
        <p>系統偵測到你的輸入可能涉及高風險情境，包括人身安全、緊急需求或重大權益決策。</p>
        <p>系統無法替代緊急服務或專業協助。若有立即危險，請優先聯繫以下資源：</p>
        ${this.safetyResources}
        <p>若你只是想整理思路或撰寫求助訊息，可以繼續，但系統不會提供操控或高風險行動策略。</p>
        <button class="ethics-close">我了解，繼續</button>
      </div>
    `;
    _modal(html, onClose);
  },

  showMediumRiskModal(onClose) {
    const html = `
      <div class="ethics-risk-mid">
        <h3>⚠️ 情境提醒</h3>
        <p>這個情境涉及關係衝突或敏感溝通。系統會提供清楚、直接、可撤回的溝通建議，不會提供報復、逼迫或冷暴力策略。</p>
        <p>請保留界線與自主決定權。若感到不安全，請尋求可信任的人或專業協助。</p>
        <button class="ethics-close">我了解，繼續</button>
      </div>
    `;
    _modal(html, onClose);
  },

  gate(text, onPass, onBlock) {
    const level = this.check(text);
    if (level === 'high') {
      this.showHighRiskModal(() => { if (onBlock) onBlock('high'); });
    } else if (level === 'medium') {
      this.showMediumRiskModal(() => { if (onPass) onPass('medium'); });
    } else {
      if (onPass) onPass('low');
    }
    return level;
  }
};

/* ─────────────────────────────────────────────
   AgeGate — age verification on first use (21.7)
   Usage: AgeGate.check(onAdult, onMinor)
   ───────────────────────────────────────────── */
const AgeGate = {
  STORAGE_KEY: 'kec_age_confirmed',

  check(onAdult, onMinor) {
    try {
      if (localStorage.getItem(this.STORAGE_KEY) === 'adult') {
        if (onAdult) onAdult();
        return;
      }
    } catch (e) { /* localStorage unavailable */ }

    const html = `
      <h3>年齡確認</h3>
      <p>本服務設計給 <strong>18 歲以上</strong>的成年使用者。若你未滿 18 歲，系統將不建立對象檔案，且部分功能受到限制。</p>
      <button class="ethics-close secondary" id="age-minor">我未滿 18 歲</button>
      <button class="ethics-close" id="age-adult">我已滿 18 歲</button>
    `;
    const overlay = _modal(html, null);
    overlay.querySelector('#age-adult').addEventListener('click', () => {
      try { localStorage.setItem(this.STORAGE_KEY, 'adult'); } catch (e) {}
      overlay.remove();
      if (onAdult) onAdult();
    });
    overlay.querySelector('#age-minor').addEventListener('click', () => {
      overlay.remove();
      this._showMinorInfo(onMinor);
    });
  },

  _showMinorInfo(onMinor) {
    const html = `
      <h3>服務限制說明</h3>
      <p>本服務目前設計供成年人使用。若你未滿 18 歲：</p>
      <ul>
        <li>不會建立長期對象檔案。</li>
        <li>不會保存出生資料或互動紀錄。</li>
        <li>如有任何人身安全顧慮，請聯繫信任的成年人或撥打 000。</li>
      </ul>
      <p>若你有疑問，請請求家長或監護人陪同使用。</p>
      <button class="ethics-close">了解</button>
    `;
    _modal(html, () => { if (onMinor) onMinor(); });
  },

  reset() {
    try { localStorage.removeItem(this.STORAGE_KEY); } catch (e) {}
  }
};

/* ─────────────────────────────────────────────
   AnalysisOutput — four-part output format (21.6)
   Usage:
     const ao = new AnalysisOutput(containerEl);
     ao.render({ known, speculative, uncertain, suggestions });
   ───────────────────────────────────────────── */

_injectCSS('ethics-analysis-css', `
  .ao-block { border: 1px solid #e8e8e8; border-radius: 10px; padding: 20px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .ao-block + .ao-block { margin-top: 12px; }
  .ao-section { margin-bottom: 16px; }
  .ao-section:last-child { margin-bottom: 0; }
  .ao-label { font-size: .75rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .ao-content { font-size: .9rem; line-height: 1.7; color: #333; }
  .ao-content ul { margin: 4px 0; padding-left: 20px; }
  .ao-speculation-tag {
    display: inline-block; background: #fff3cd; color: #856404; border: 1px solid #ffc107;
    border-radius: 4px; font-size: .75rem; padding: 2px 8px; margin-bottom: 10px;
    font-weight: 600;
  }
  .ao-section-known    .ao-label { color: #1a6f3c; }
  .ao-section-spec     .ao-label { color: #a0522d; }
  .ao-section-uncertain .ao-label { color: #5a4e9a; }
  .ao-section-suggest  .ao-label { color: #0066cc; }
`);

class AnalysisOutput {
  static BANNED = ['一定', '注定', '本質上', '絕對', '他就是這種人', '她就是這種人', '百分之百'];
  static REPLACE_MAP = {
    '一定': '可能',
    '注定': '傾向於',
    '本質上': '目前看來',
    '絕對': '大多數情況下',
    '百分之百': '目前可以先假設',
    '他就是這種人': '他目前呈現的模式是',
    '她就是這種人': '她目前呈現的模式是'
  };

  constructor(containerEl) {
    this.container = containerEl;
  }

  _filter(text) {
    if (!text) return text;
    let out = text;
    for (const [bad, good] of Object.entries(AnalysisOutput.REPLACE_MAP)) {
      out = out.replaceAll(bad, good);
    }
    return out;
  }

  _renderContent(content) {
    if (Array.isArray(content)) {
      return `<ul>${content.map(i => `<li>${this._filter(i)}</li>`).join('')}</ul>`;
    }
    return `<p>${this._filter(content)}</p>`;
  }

  render({ known, speculative, uncertain, suggestions, title } = {}) {
    const block = document.createElement('div');
    block.className = 'ao-block';
    block.setAttribute('role', 'region');
    block.setAttribute('aria-label', '分析結果');

    const sections = [];
    if (title) sections.push(`<div style="font-weight:700;font-size:1rem;margin-bottom:14px;color:#1a1a1a;">${title}</div>`);

    sections.push(`<span class="ao-speculation-tag">⚠️ 以下包含推測內容，不代表事實</span>`);

    if (known) {
      sections.push(`<div class="ao-section ao-section-known">
        <div class="ao-label">已知資訊（使用者提供）</div>
        <div class="ao-content">${this._renderContent(known)}</div>
      </div>`);
    }
    if (speculative) {
      sections.push(`<div class="ao-section ao-section-spec">
        <div class="ao-label">暫定推測（系統根據資料提出的可能性）</div>
        <div class="ao-content">${this._renderContent(speculative)}</div>
      </div>`);
    }
    if (uncertain) {
      sections.push(`<div class="ao-section ao-section-uncertain">
        <div class="ao-label">不確定性（目前無法確認）</div>
        <div class="ao-content">${this._renderContent(uncertain)}</div>
      </div>`);
    }
    if (suggestions) {
      sections.push(`<div class="ao-section ao-section-suggest">
        <div class="ao-label">建議行動（尊重對方選擇的溝通方式）</div>
        <div class="ao-content">${this._renderContent(suggestions)}</div>
      </div>`);
    }

    block.innerHTML = sections.join('');
    this.container.appendChild(block);
    return block;
  }
}

/* ─── Export ─── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EthicsDisclaimer, ThirdPartyWarning, RiskGate, AgeGate, AnalysisOutput };
}
