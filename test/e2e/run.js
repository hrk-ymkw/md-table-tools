'use strict';

// Drive the actual VS Code workbench and its webview; assert persisted Markdown.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const locale = process.env.MDT_TEST_LOCALE || 'en';
const i18n = require('../../media/i18n');
const t = i18n.createTranslator(locale);
const commandTitle = require(i18n.language(locale) === 'ja' ? '../../package.nls.ja.json' : '../../package.nls.json')['command.openTablePreview'];

const root = path.resolve(__dirname, '../..');
const results = path.join(root, 'test-results');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdt-e2e-'));
const source = fs.readFileSync(path.join(root, 'test/fixtures/demo.md'), 'utf8');
const file = path.join(temp, 'demo.md');
fs.writeFileSync(file, source);
fs.copyFileSync(path.join(root, 'test/fixtures/icon.png'), path.join(temp, 'icon.png'));
fs.mkdirSync(results, { recursive: true });
for (const name of ['e2e-failure.png', 'e2e-state.txt']) {
  const previous = path.join(results, name);
  if (fs.existsSync(previous)) fs.unlinkSync(previous);
}
const executable = process.env.VSCODE_BIN || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : 'code');

async function until(fn, description, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch (e) { last = e; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${description}${last ? ` (${last.message})` : ''}`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const port = await freePort();
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`, `--locale=${locale}`, '--disable-gpu', '--skip-welcome', '--skip-release-notes',
    '--disable-workspace-trust', '--new-window', `--user-data-dir=${path.join(temp, 'user')}`,
    `--extensions-dir=${path.join(temp, 'extensions')}`, `--extensionDevelopmentPath=${root}`, file,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(results, 'e2e-vscode.log'));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let browser, page;
  try {
    await until(async () => {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); return true; }
      catch { return false; }
    }, 'VS Code debugging endpoint', 60000);
    const context = browser.contexts()[0];
    await until(() => context.pages().length > 0, 'VS Code window');
    page = context.pages()[0];
    const editor = page.locator('.monaco-editor').first();
    await editor.waitFor({ state: 'visible', timeout: 60000 });
    await editor.click({ position: { x: 80, y: 80 } });
    await page.keyboard.press('Control+Shift+p');
    await page.keyboard.insertText(commandTitle);
    await page.getByText(commandTitle, { exact: false }).first().waitFor({ timeout: 30000 });
    await page.keyboard.press('Enter');
    let frame;
    await until(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('#mdt-body').count() && await candidate.locator('table.mdt').count()) { frame = candidate; return true; }
      }
      return false;
    }, 'editable Markdown preview', 60000);
    const table = frame.locator('table.mdt').first();
    const rows = table.locator('tbody tr');
    const cell = (row, col) => rows.nth(row).locator('td').nth(col);
    const saved = () => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const initial = source.replace(/\r\n/g, '\n');
    const expectSaved = (value) => until(() => saved() === value, 'saved Markdown');
    await until(async () => await rows.count() === 3, 'three table rows');

    // Direct editing and Tab move between cells; both edits must be saved.
    await cell(0, 0).click();
    await frame.locator('textarea.mdt-cell-input').fill('Apple');
    await frame.locator('textarea.mdt-cell-input').press('Tab');
    await frame.locator('textarea.mdt-cell-input').fill('14');
    await frame.locator('textarea.mdt-cell-input').press('Enter');
    const edited = initial.replace('| りんご | 12 | 完了 |', '| Apple | 14 | 完了 |');
    await expectSaved(edited);
    console.log('PASS cell editing, Tab and auto-save preserve surrounding Markdown');

    await frame.locator('body').press('Control+z');
    await expectSaved(initial.replace('| りんご | 12 | 完了 |', '| Apple | 12 | 完了 |'));
    await frame.locator('body').press('Control+Shift+z');
    await expectSaved(edited);
    console.log('PASS undo and redo');

    await table.locator('thead tr').first().locator('th').nth(1).click();
    await until(async () => (await cell(0, 0).innerText()) === 'バナナ', 'ascending sort');
    await table.locator('input.mdt-filter').nth(2).fill('完了');
    await until(async () => (await rows.filter({ visible: true }).count()) === 2, 'filter');
    assert.equal(saved(), edited, 'sort and filter must not alter the file');
    await table.locator('input.mdt-filter').nth(2).fill('');
    console.log('PASS sort and filter are display-only');

    await cell(0, 0).click({ button: 'right' });
    await frame.getByRole('button', { name: t('insertRowBelow') }).click();
    await until(async () => (await rows.count()) === 4, 'insert row');
    await until(() => saved().split('\n').some((line) => /^\|\s*\|\s*\|\s*\|$/.test(line)), 'saved empty row');
    await cell(0, 0).click({ button: 'right' });
    await frame.getByRole('button', { name: t('insertColumnRight') }).click();
    await until(async () => (await table.locator('thead tr').first().locator('th').count()) === 4, 'insert column');
    await until(() => /^\| 品目 \|\s*\| 数量 \| 状態 \|$/m.test(saved()), 'saved inserted column');
    assert.ok(saved().startsWith(initial.slice(0, initial.indexOf('| 品目 |'))));
    assert.ok(saved().endsWith(initial.slice(initial.indexOf('\n## Mermaid'))));
    const emptyRow = rows.filter({ has: frame.locator('td') }).filter({ hasText: /^\s*$/ });
    await emptyRow.locator('td').first().click({ button: 'right' });
    await frame.getByRole('button', { name: t('deleteRow') }).click();
    await until(async () => (await rows.count()) === 3, 'delete row');
    await cell(0, 1).click({ button: 'right' });
    await frame.getByRole('button', { name: t('deleteColumn') }).click();
    await until(async () => (await table.locator('thead tr').first().locator('th').count()) === 3, 'delete column');
    await expectSaved(edited);
    console.log('PASS row and column insertion and deletion preserve surrounding Markdown');

    // Change the file externally while the preview cell still has focus. The host
    // must refuse the stale edit instead of overwriting the other writer.
    const apple = rows.filter({ hasText: 'Apple' }).locator('td').first();
    await apple.click();
    await frame.locator('textarea.mdt-cell-input').fill('stale edit');
    const external = edited.replace('| Apple | 14 | 完了 |', '| External | 14 | 完了 |');
    fs.writeFileSync(file, external);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await frame.locator('textarea.mdt-cell-input').press('Enter');
    // Depending on the watcher timing, the extension may reject a stale cell
    // or VS Code may refuse to save over a newer file. Both must warn the user.
    await page.getByText(new RegExp([t('cellChanged'), t('saveFailed')].map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))).first().waitFor({ timeout: 20000 });
    assert.equal(saved(), external, 'a conflicting external edit must survive');
    console.log('PASS conflicting external edit is not overwritten');
  } catch (error) {
    if (page) {
      try { await page.screenshot({ path: path.join(results, 'e2e-failure.png') }); } catch {}
      try { fs.writeFileSync(path.join(results, 'e2e-state.txt'), await page.locator('body').innerText()); } catch {}
    }
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill();
    log.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
