'use strict';
const assert = require('assert').strict;
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function run() {
  const results = [];
  const extension = vscode.extensions.getExtension('hrk-ymkw.md-table-tools');
  if (!extension) throw new Error('The extension was not found in the test host');
  await extension.activate();
  const { applyOp, splitTableRow } = require(path.join(extension.extensionPath, 'extension.js'))._test;
  async function check(name, fn) {
    try { await fn(); results.push(`PASS ${name}`); }
    catch (e) { results.push(`FAIL ${name}: ${e.stack}`); }
  }
  await vscode.workspace.getConfiguration('mdTableTools').update('autoSave', false, vscode.ConfigurationTarget.Global);
  await check('messages follow the VS Code display language', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '| H |\n| --- |\n| a |' });
    const expected = /^ja(?:-|$)/i.test(vscode.env.language)
      ? 'セルが変更されたため、編集を停止しました' : 'Editing stopped because the cell has changed.';
    await assert.rejects(applyOp(doc, 'edit-cell', { line: 2, col: 0, text: 'b', original: 'stale' }), { message: expected });
  });
  await check('Markdown renderer preserves raw cell source', async () => {
    const html = await vscode.commands.executeCommand('markdown.api.render', '| H |\n| --- |\n| [link](a) |');
    assert.match(html, /data-raw="\[link\]\(a\)"/, html);
    assert.match(html, /data-mdt-source=/, html);
    assert.ok(html.includes(`data-mdt-language="${/^ja(?:-|$)/i.test(vscode.env.language) ? 'ja' : 'en'}"`), html);
  });
  await check('edit, undo and redo preserve surrounding Markdown', async () => {
    const text = 'Before **bold**\n\n| Name | Value |\n| --- | --- |\n| [link](a) | x |\n\nAfter';
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
    await applyOp(doc, 'edit-cell', { line: 4, col: 1, text: 'new | value', original: 'x' });
    assert.equal(doc.getText(), text.replace('| [link](a) | x |', '| [link](a) | new \\| value |'));
    const edited = doc.getText();
    await applyOp(doc, 'undo', {});
    assert.equal(doc.getText(), text);
    await applyOp(doc, 'redo', {});
    assert.equal(doc.getText(), edited);
  });
  await check('stale edits and undo conflicts do not change the document', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '| H |\n| --- |\n| a |' });
    await applyOp(doc, 'edit-cell', { line: 2, col: 0, text: 'b', original: 'a' });
    await assert.rejects(applyOp(doc, 'edit-cell', { line: 2, col: 0, text: 'c', original: 'a' }));
    const beforeOversize = doc.getText();
    await assert.rejects(applyOp(doc, 'edit-cell', { line: 2, col: 0, text: 'x'.repeat(10001), original: 'b' }));
    assert.equal(doc.getText(), beforeOversize);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(2, 2, 2, 3), 'external');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    const current = doc.getText();
    await assert.rejects(applyOp(doc, 'undo', {}));
    assert.equal(doc.getText(), current);
  });
  await check('external changes outside the table invalidate undo history', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: 'Before\n\n| H |\n| --- |\n| a |' });
    await applyOp(doc, 'edit-cell', { line: 4, col: 0, text: 'b', original: 'a' });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(0, 0), 'external ');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    const current = doc.getText();
    await assert.rejects(applyOp(doc, 'undo', {}));
    assert.equal(doc.getText(), current);
    await applyOp(doc, 'edit-cell', { line: 4, col: 0, text: 'c', original: 'b' });
    await applyOp(doc, 'undo', {});
    assert.equal(doc.getText(), current);
    await applyOp(doc, 'undo', {});
    assert.equal(doc.getText(), current);
  });
  await check('indented rows and trailing whitespace retain their boundaries', async () => {
    const source = '  | A | B |   \n  | --- | --- |  \n  | x | y |  ';
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: source });
    await applyOp(doc, 'edit-cell', { line: 2, col: 1, original: 'y', text: 'z' });
    assert.equal(doc.getText(), source.replace('| x | y |', '| x | z |'));
  });
  await check('row and column operations and invalid indices', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '| A | B |\n| --- | --- |\n| x | y |' });
    await applyOp(doc, 'insert-row', { line: 2, before: false, expectedTable: doc.getText() });
    assert.equal(doc.lineCount, 4);
    await applyOp(doc, 'delete-row', { line: 3, expectedTable: doc.getText() });
    assert.equal(doc.lineCount, 3);
    await applyOp(doc, 'insert-col', { line: 2, col: 0, before: false, expectedTable: doc.getText() });
    assert.equal(splitTableRow(doc.lineAt(0).text).length, 3);
    await applyOp(doc, 'delete-col', { line: 2, col: 1, expectedTable: doc.getText() });
    assert.equal(splitTableRow(doc.lineAt(0).text).length, 2);
    const current = doc.getText();
    await assert.rejects(applyOp(doc, 'insert-col', { line: 2, col: 99, expectedTable: current }));
    await assert.rejects(applyOp(doc, 'delete-row', { line: 2, expectedTable: 'stale' }));
    assert.equal(doc.getText(), current);
  });
  await check('auto-save writes escaped cell text to the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-table-save-'));
    const file = path.join(dir, 'table.md');
    fs.writeFileSync(file, '| H |\n| --- |\n| a |\n');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.workspace.getConfiguration('mdTableTools').update('autoSave', true, vscode.ConfigurationTarget.Global);
    try {
      await applyOp(doc, 'edit-cell', { line: 2, col: 0, text: 'one \\| two | three', original: 'a' });
      assert.match(fs.readFileSync(file, 'utf8'), /one \\\| two \\\| three/);
      assert.equal(doc.isDirty, false);
    } finally {
      await vscode.workspace.getConfiguration('mdTableTools').update('autoSave', false, vscode.ConfigurationTarget.Global);
    }
  });
  console.log(results.join('\n'));
  if (process.env.MDT_TEST_RESULT) fs.writeFileSync(process.env.MDT_TEST_RESULT, JSON.stringify(results));
  if (results.some((r) => r.startsWith('FAIL'))) throw new Error('Integration tests failed');
}
module.exports = { run };
