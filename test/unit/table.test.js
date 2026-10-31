'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, ...args);
};
const { splitTableRow, isDelimiterRow, assertTableContext, handleOpMsg } = require('../../extension')._test;
Module._load = originalLoad;

function doc(text, languageId = 'markdown') {
  const lines = text.split('\n');
  return { languageId, lineCount: lines.length, lineAt: (i) => ({ text: lines[i] }) };
}

test('escaped pipes remain inside the same cell', () => {
  assert.deepEqual(splitTableRow('| a\\|b | c |').map((c) => c.text.trim()), ['a\\|b', 'c']);
  assert.deepEqual(splitTableRow('a | b').map((c) => c.text.trim()), ['a', 'b']);
  assert.deepEqual(splitTableRow('  | a | b |   ').map((c) => c.text.trim()), ['a', 'b']);
  assert.deepEqual(splitTableRow('| a |  |').map((c) => c.text.trim()), ['a', '']);
});

test('recognizes alignment delimiters and rejects ordinary rows', () => {
  assert.equal(isDelimiterRow('| :--- | ---: | :-: |'), true);
  assert.equal(isDelimiterRow('| a | b |'), false);
});

test('rejects edits outside a Markdown table', () => {
  assert.deepEqual(assertTableContext(doc('before\n| h |\n| --- |\n| x |\nafter'), 3), { start: 1, end: 3 });
  assert.throws(() => assertTableContext(doc('a | b\nnot a delimiter'), 0), /not a table/);
  assert.throws(() => assertTableContext(doc('| h |\n| --- |', 'plaintext'), 0), /not a markdown/);
  assert.throws(() => assertTableContext(doc('| h |\n| --- |'), -1), /invalid line/);
  assert.throws(() => assertTableContext(doc('```md\n| h |\n| --- |\n| x |\n```'), 3), /code block/);
  assert.throws(() => assertTableContext(doc('| h |\n| --- |\n    | code |'), 0), /indented/);
});

test('rejects malformed or unbound webview messages', async () => {
  await assert.rejects(handleOpMsg(null), /invalid message/);
  await assert.rejects(handleOpMsg({ op: 'edit-cell', d: 'file:///other', p: {} }), /document has changed/);
});
