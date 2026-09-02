'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const PUBLIC_FILES = [
  'index.html',
  'enroll.html',
  'firstimpression.html',
  'report.html',
  'quiz/index.html',
  'quiz/result.html',
  'quiz/checkout.html',
  'quiz/success.html',
  'quiz/quiz-data.js',
  'quiz/quiz-logic.js',
  'quiz/track.js',
];
const BANNED_TERMS = ['紫微', '八字', '流年', '宮位', '主星', '命盤', '保證', '一定', '註定', '100%', '招財', '桃花'];

function customerFacingText(source) {
  return source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('公開頁面與瀏覽器端程式不含品牌禁用語', () => {
  for (const relativePath of PUBLIC_FILES) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    const text = customerFacingText(source);
    for (const term of BANNED_TERMS) {
      assert.ok(!text.includes(term), `${relativePath} 不得包含「${term}」`);
    }
  }
});
