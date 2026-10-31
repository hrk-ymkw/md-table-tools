'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { language, createTranslator } = require('../../media/i18n');
const root = path.resolve(__dirname, '../..');

test('Japanese locales are recognized and other locales fall back to English', () => {
  for (const locale of ['ja', 'ja-JP', 'JA-jp']) {
    assert.equal(language(locale), 'ja');
    assert.equal(createTranslator(locale)('editCell'), 'セルを編集');
  }
  for (const locale of [undefined, '', 'en', 'en-GB', 'de', 'javanese']) {
    assert.equal(language(locale), 'en');
    assert.equal(createTranslator(locale)('editCell'), 'Edit Cell');
  }
  assert.equal(createTranslator('en')('previewTitle', '日本語.md'), 'Preview: 日本語.md');
  assert.equal(createTranslator('ja')('previewTitle', 'English.md'), 'プレビュー: English.md');
});

test('the browser bundle works without Node globals and preserves literal substitutions', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'media/i18n.js'), 'utf8'), context);
  assert.equal(context.mdtI18n.createTranslator('en')('filterColumn', 2), 'Filter column 2');
  assert.equal(context.mdtI18n.createTranslator('ja')('filterColumn', 2), '列 2 を絞り込み');
  assert.equal(context.mdtI18n.createTranslator('en')('previewTitle', '$&{0}'), 'Preview: $&{0}');
});

test('all manifest localization placeholders resolve in both languages', () => {
  const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const english = require('../../package.nls.json');
  const japanese = require('../../package.nls.ja.json');
  assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
  for (const [, key] of manifest.matchAll(/%([^%]+)%/g)) {
    assert.ok(english[key], key);
    assert.ok(japanese[key], key);
  }
  assert.equal(english['command.openTablePreview'], 'Open Table Preview');
  assert.equal(japanese['command.openTablePreview'], 'テーブルプレビューを開く');
});

test('extension errors use the host locale and retain editing guards', () => {
  const extensionPath = path.join(root, 'extension.js');
  const source = fs.readFileSync(extensionPath, 'utf8');
  const nativeRequire = createRequire(extensionPath);
  for (const [locale, message] of [['en', 'Cannot edit inside a code block.'], ['ja', 'コードブロック内は編集できません'], ['fr', 'Cannot edit inside a code block.']]) {
    const context = vm.createContext({
      require: (name) => name === 'vscode' ? { env: { language: locale } } : nativeRequire(name),
      __dirname: root, module: { exports: {} },
    });
    vm.runInContext(source, context);
    const lines = ['```md', '| H |', '| --- |', '| a |', '```'];
    const doc = { languageId: 'markdown', lineCount: lines.length, lineAt: (i) => ({ text: lines[i] }) };
    assert.throws(() => context.module.exports._test.assertTableContext(doc, 3), { message });
  }
});
