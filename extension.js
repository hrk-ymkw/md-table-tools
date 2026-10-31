// Markdown Table Tools — extension host side
// - 独自プレビューパネル (webview) — テーブル編集/ソート/フィルタ
// - markdown-it plugin: 標準プレビュー側のセルに生テキスト(data-raw)を埋め込む
// - URIハンドラ: 標準プレビューからの操作を受ける(対応環境向け)
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const i18n = require('./media/i18n');
const language = i18n.language(vscode.env && vscode.env.language);
const t = i18n.createTranslator(language);

const LOG_FILE = path.join(__dirname, 'debug.log');
function log(...args) {
  try {
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + args.join(' ') + '\n');
  } catch {}
}

let panel = null;
let panelDocUri = null;
let refreshTimer = null;
let changeSub = null;
// プレビュー起点でエディタを動かした直後のスクロール通知をプレビューに返さないための抑制窓
let suppressSyncUntil = 0;
let lastSyncLine = -1; // 重複通知の間引き用

function activate(context) {
  log('activate');
  registerScrollSync(context);
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        handleOp(uri).catch((e) => {
          vscode.window.showWarningMessage(`MD Table Tools: ${e.message}`);
        });
      },
    }),
    vscode.commands.registerCommand('md-table-tools.openTablePreview', () => {
      openPreview(context).catch((e) => {
        vscode.window.showWarningMessage(`MD Table Tools: ${e.message}`);
      });
    })
  );
  return { extendMarkdownIt };
}

function deactivate() {}

// ---------------------------------------------------------------------------
// 独自プレビューパネル
// ---------------------------------------------------------------------------

// インストール済み拡張が標準プレビューに提供するリソース(mermaid/katex等)を流用する。
// 本体スクリプト(markdown-language-features)も含め、こちらがホスト役を演じる。
// webview側の preview.js が acquireVsCodeApi を先にラップして共有するので衝突しない。
function collectPreviewContrib(context) {
  const entries = [];
  const roots = [vscode.Uri.joinPath(context.extensionUri, 'media')];
  for (const ext of vscode.extensions.all) {
    if (ext.id === context.extension.id) continue;
    const contrib = (ext.packageJSON && ext.packageJSON.contributes) || {};
    const styles = (contrib['markdown.previewStyles'] || [])
      .map((e) => (typeof e === 'string' ? e : e && e.path))
      .filter(Boolean);
    const scripts = (contrib['markdown.previewScripts'] || [])
      .map((e) =>
        typeof e === 'string' ? { path: e, module: false } : e && e.path ? { path: e.path, module: e.type === 'module' } : null
      )
      .filter(Boolean);
    // codiconアイコンフォント(mermaidツールバー用)が同梱されていればそれも読む
    const codiconCss = vscode.Uri.joinPath(ext.extensionUri, 'chat-webview-out/codicon.css');
    try {
      if (fs.existsSync(codiconCss.fsPath)) styles.push('chat-webview-out/codicon.css');
    } catch {}
    if (!styles.length && !scripts.length) continue;
    entries.push({ extUri: ext.extensionUri, styles, scripts });
    roots.push(ext.extensionUri);
    log('preview contrib: ' + ext.id + (styles.length ? ' styles=' + styles.length : '') + (scripts.length ? ' scripts=' + scripts.length : ''));
  }
  return { entries, roots };
}

function getNonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

async function renderDoc(doc) {
  const html = await vscode.commands.executeCommand('markdown.api.render', doc.getText());
  return html;
}

// レンダリング結果の相対パス src（画像等）を webview 読み込み可能な URI に書き換える
// （標準プレビューが <base> + 本体スクリプトでやっていることの軽量版）
function fixResourceSrc(html, docUri, webview) {
  const base = vscode.Uri.joinPath(docUri, '..');
  return html.replace(/\bsrc="([^"]*)"/gi, (m, val) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(val)) return m; // 絶対/スキーム付き/フラグメントはそのまま
    try {
      const u = webview.asWebviewUri(vscode.Uri.joinPath(base, decodeURIComponent(val)));
      return `src="${u}"`;
    } catch {
      return m;
    }
  });
}

async function openPreview(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showInformationMessage(t('openMarkdown'));
    return;
  }
  const doc = editor.document;
  panelDocUri = doc.uri;

  const column =
    vscode.workspace.getConfiguration('mdTableTools').get('openIn') === 'beside'
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.Active;

  if (panel) {
    panel.reveal(column);
  } else {
    const contrib = collectPreviewContrib(context);
    // 相対パス画像を読めるようドキュメントのディレクトリとワークスペースを許可
    contrib.roots.push(vscode.Uri.joinPath(doc.uri, '..'));
    for (const wf of vscode.workspace.workspaceFolders || []) {
      contrib.roots.push(wf.uri);
    }
    panel = vscode.window.createWebviewPanel(
      'mdTableToolsPreview',
      '',
      column,
      {
        enableScripts: true,
        localResourceRoots: contrib.roots,
      }
    );
    const mediaUri = (p) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', p));
    const extUri = (base, rel) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(base, rel));
    const contribStyles = contrib.entries
      .flatMap((e) => e.styles.map((rel) => `<link href="${extUri(e.extUri, rel)}" rel="stylesheet">`))
      .join('\n');
    // script-src はnonceのみ許可。文書内の<script src>を fixResourceSrc が
    // webview URIへ書き換えても nonce が無いのでCSPが遮断する（標準プレビューと同じ方式）
    const nonce = getNonce();
    const contribScripts = contrib.entries
      .flatMap((e) =>
        e.scripts.map(
          (s) =>
            `<script${s.module ? ' type="module"' : ''} nonce="${nonce}" src="${extUri(e.extUri, s.path)}"></script>`
        )
      )
      .join('\n');
    const csp = panel.webview.cspSource;
    const initialHtml = fixResourceSrc(await renderDoc(doc), doc.uri, panel.webview);
    // 本体scriptは data-initial-md-content から初期HTMLをbodyへ追加する
    const initialContent = `<div class="markdown-body">${initialHtml}</div>`
      .replace(/&/g, '&amp;')
      .replace(/'/g, '&#39;');
    // 本体プレビュースクリプトが読む起動設定（標準プレビューと同じ形式）
    const settings = {
      source: doc.uri.toString(),
      line: editor.selection.active.line,
      selectedLine: editor.selection.active.line,
      lineCount: doc.lineCount,
      scrollPreviewWithEditor: true,
      scrollPreviewBeyondEditorLine: true,
      doubleClickToSwitchToEditor: vscode.workspace
        .getConfiguration('markdown.preview')
        .get('doubleClickToSwitchToEditor', true),
      disableSecurityWarnings: true,
      fragment: null,
      lineChanges: null,
      diffScrollSync: null,
    };
    const settingsJson = JSON.stringify(settings).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    // エディタ側が末尾を超えてスクロールできる場合、プレビューも同じだけ余白を持たせる
    // （markdown.cssの body.scrollBeyondLastLine ルールが効く）
    const beyond = vscode.workspace
      .getConfiguration('editor', { uri: doc.uri, languageId: 'markdown' })
      .get('scrollBeyondLastLine', false);
    const bodyClass = 'vscode-body' + (beyond ? ' scrollBeyondLastLine' : '');
    // 本体scriptは data-state（スクロール状態復元用）も読む
    const stateJson = JSON.stringify({ line: editor.selection.active.line }).replace(/'/g, '&#39;');
    panel.webview.html = `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data:; font-src ${csp} data:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
${contribStyles}
<link href="${mediaUri('preview.css')}" rel="stylesheet">
<title>${t('previewPageTitle')}</title>
</head>
<body class="${bodyClass}">
<div id="vscode-markdown-preview-data" data-settings='${settingsJson}' data-state='${stateJson}' data-initial-md-content='${initialContent}' style="display:none"></div>
<div id="mdt-body"></div>
<script nonce="${nonce}" src="${mediaUri('i18n.js')}"></script>
<script nonce="${nonce}" src="${mediaUri('preview.js')}"></script>
${contribScripts}
</body>
</html>`;

    panel.webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.op) {
        handleOpMsg(msg).catch((e) => {
          vscode.window.showWarningMessage(`MD Table Tools: ${e.message}`);
        });
        return;
      }
      if (msg.type) {
        // 本体スクリプトからのメッセージ（標準プレビューのホスト役）
        handleCoreMsg(msg).catch((e) => log('core msg error: ' + e.message));
      }
    });
    panel.onDidDispose(() => {
      panel = null;
      panelDocUri = null;
      if (changeSub) {
        changeSub.dispose();
        changeSub = null;
      }
    });
  }

  panel.title = t('previewTitle', doc.uri.path.split('/').pop());

  if (changeSub) changeSub.dispose();
  changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (panelDocUri && e.document.uri.toString() === panelDocUri.toString()) {
      scheduleRefresh();
    }
  });

  await sendUpdate();
}

async function sendUpdate() {
  if (!panel || !panelDocUri) return;
  if (cellEditing) return; // セル編集中は再描画しない（textareaを壊さないため）
  try {
    const doc = await vscode.workspace.openTextDocument(panelDocUri);
    const html = fixResourceSrc(await renderDoc(doc), doc.uri, panel.webview);
    const source = doc.uri.toString();
    log('sendUpdate html.length=' + html.length);
    // 本体スクリプトのプロトコルで送る（morphdom差分パッチ＋スクロール位置維持）
    panel.webview.postMessage({
      type: 'updateContent',
      content: `<div class="markdown-body">${html}</div>`,
      source,
      lineChanges: null,
      diffScrollSync: null,
    });
    // 本体スクリプト未ロード時のフォールバック
    panel.webview.postMessage({ type: 'mdt-update', html, source });
  } catch (e) {
    log('sendUpdate error: ' + e.message);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(sendUpdate, 150);
}

// ---------------------------------------------------------------------------
// 本体スクリプトのメッセージに応答するホスト役
// ---------------------------------------------------------------------------

function clampLine(doc, line) {
  const l = Math.floor(Number(line) || 0);
  return Math.max(0, Math.min(l, doc.lineCount - 1));
}

// 小数行 → 行内文字位置まで使ったRange（公式 scrollEditorToLine と同じ。
// プレビューはスクロール位置を小数行で送ってくるので滑らかに同期する）
function editorRangeForLine(doc, t) {
  t = Math.max(0, Number(t) || 0);
  const r = Math.floor(t);
  if (r >= doc.lineCount) {
    const last = doc.lineCount - 1;
    return new vscode.Range(last, 0, last, 0);
  }
  const frac = t - r;
  const len = doc.lineAt(r).text.length;
  const col = Math.max(0, Math.min(len, Math.floor(len * frac)));
  return new vscode.Range(r, col, r, col);
}

// エディタの先頭可視行を小数で取る（公式 getVisibleLine と同じ式）
function getVisibleLineFractional(ed) {
  if (!ed.visibleRanges.length) return 0;
  const pos = ed.visibleRanges[0].start;
  const text = ed.document.lineAt(pos.line).text;
  return pos.line + pos.character / (text.length + 2);
}

async function handleCoreMsg(msg) {
  if (!panelDocUri) return;
  const doc = await vscode.workspace.openTextDocument(panelDocUri);
  switch (msg.type) {
    case 'didClick': {
      // ダブルクリック → ソース行へジャンプ（エディタにフォーカス）
      // こちらもエディタ側の移動通知をプレビューへ返さない
      suppressSyncUntil = Date.now() + 200;
      const line = clampLine(doc, msg.line);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(line, 0, line, 0),
      });
      break;
    }
    case 'revealLine': {
      // プレビュー側スクロール → エディタ側を追従（フォーカスは奪わない）
      if (!vscode.workspace.getConfiguration('markdown.preview').get('scrollEditorWithPreview', true)) break;
      // 公式と同じく200msのリセット式抑制窓: スクロール中はrevealLineが連続で届き
      // 毎回延長されるので、止まって200ms後に自動解除される
      suppressSyncUntil = Date.now() + 200;
      const ed = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === panelDocUri.toString()
      );
      if (ed) {
        // AtTopで合わせる: エディタ先頭行=プレビューが送った行になるので、
        // スクロール通知が漏れて折り返しても同じ位置に戻るだけでループしない
        ed.revealRange(editorRangeForLine(doc, msg.line), vscode.TextEditorRevealType.AtTop);
      }
      break;
    }
    case 'openLink':
      await handleOpenLink(msg.href, doc.uri);
      break;
    case 'cspViolation':
      log('CSP blocked: ' + (msg.blockedUri || '') + ' (' + (msg.directive || '') + ')');
      break;
  }
}

async function handleOpenLink(href, docUri) {
  if (!href) return;
  if (/^https?:/i.test(href)) {
    await vscode.env.openExternal(vscode.Uri.parse(href));
    return;
  }
  const h = href.indexOf('#');
  const frag = h >= 0 ? href.slice(h + 1) : '';
  const rel = h >= 0 ? href.slice(0, h) : href;
  if (!rel) {
    // 同一文書内アンカー → パネル内でスクロール
    if (panel) panel.webview.postMessage({ type: 'mdt-scrollTo', id: frag });
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) {
    // 開いてよいスキームを限定（command:/javascript: 等は通さない）
    if (/^(file|vscode|vscode-remote|vscode-vfs|vscode-userdata|mailto):/i.test(rel)) {
      try {
        if (/^mailto:/i.test(rel)) {
          await vscode.env.openExternal(vscode.Uri.parse(rel));
        } else {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(rel));
        }
      } catch {}
    } else {
      log('openLink blocked scheme: ' + rel.split(':', 1)[0]);
    }
    return;
  }
  try {
    const target = vscode.Uri.joinPath(vscode.Uri.joinPath(docUri, '..'), decodeURIComponent(rel));
    await vscode.commands.executeCommand('vscode.open', target);
  } catch (e) {
    log('openLink failed: ' + href + ' ' + e.message);
  }
}

// エディタ→プレビュー方向のスクロール同期（activate時に一度だけ登録）
// 公式(TopmostLineMonitor)と同じく50msのトレーリングスロットルでまとめて送る
let syncThrottleTimer = null;
let pendingSyncLine = -1;
function queueUpdateView(line) {
  pendingSyncLine = line;
  if (syncThrottleTimer) return;
  syncThrottleTimer = setTimeout(() => {
    syncThrottleTimer = null;
    if (!panel || !panelDocUri) return;
    if (pendingSyncLine === lastSyncLine) return;
    lastSyncLine = pendingSyncLine;
    panel.webview.postMessage({
      type: 'updateView',
      source: panelDocUri.toString(),
      line: pendingSyncLine,
    });
  }, 50);
}

function registerScrollSync(context) {
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!panel || !panelDocUri) return;
      if (Date.now() < suppressSyncUntil) return;
      if (!vscode.workspace.getConfiguration('markdown.preview').get('scrollPreviewWithEditor', true)) return;
      if (e.textEditor.document.uri.toString() !== panelDocUri.toString()) return;
      queueUpdateView(getVisibleLineFractional(e.textEditor));
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!panel || !panelDocUri) return;
      if (Date.now() < suppressSyncUntil) return;
      if (e.textEditor.document.uri.toString() !== panelDocUri.toString()) return;
      panel.webview.postMessage({
        type: 'onDidChangeTextEditorSelection',
        source: panelDocUri.toString(),
        line: e.selections[0].active.line,
      });
    })
  );
}

// 編集opを直列化する（連続クリック等で複数opが並走すると
// WorkspaceEdit の適用が衝突して applyEdit=false になるため）
let opTail = Promise.resolve();
// webview がセル編集中か（編集中は再描画メッセージを保留して
// morphdom による textarea 破壊＝ちらつき/フォーカス喪失を防ぐ）
let cellEditing = false;

async function handleOpMsg(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.op !== 'string') throw new Error('invalid message');
  if (msg.op === 'ready') {
    log('ready');
    await sendUpdate();
    // 本体スクリプト(module)のメッセージ登録より先にupdateContentが届くと消えるので保険の再送
    setTimeout(() => {
      if (panel) sendUpdate();
    }, 300);
    return;
  }
  if (msg.op === 'log') {
    log('[webview]', msg.text);
    return;
  }
  if (msg.op === 'edit-unavailable') {
    vscode.window.showWarningMessage(t('missingSource'));
    return;
  }
  if (msg.op === 'edit-state') {
    cellEditing = !!(msg.p && msg.p.active);
    if (!cellEditing && panel) sendUpdate(); // 編集中に保留した分をまとめて流す
    return;
  }
  if (!panelDocUri || typeof msg.d !== 'string' || msg.d !== panelDocUri.toString()) {
    throw new Error(t('documentChanged'));
  }
  if (!msg.p || typeof msg.p !== 'object' || Array.isArray(msg.p)) throw new Error('invalid payload');
  log('op=' + msg.op);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(msg.d));
  opTail = opTail
    .catch(() => {}) // 前のopの失敗を引きずらずキューを継続
    .then(() => applyOp(doc, msg.op, msg.p || {}));
  await opTail;
  log('op done: ' + msg.op);
}

// ---------------------------------------------------------------------------
// markdown-it plugin (標準プレビュー用)
// ---------------------------------------------------------------------------

function extendMarkdownIt(md) {
  let srcLines = [];
  const origParse = md.parse.bind(md);
  md.parse = (text, env) => {
    srcLines = text.split(/\r?\n/);
    return origParse(text, env);
  };

  const prevTable =
    md.renderer.rules.table_open ||
    ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.table_open = (tokens, idx, opts, env, self) => {
    tokens[idx].attrSet('data-mdt-scheme', vscode.env.uriScheme || 'vscode');
    tokens[idx].attrSet('data-mdt-language', language);
    const map = tokens[idx].map;
    if (map && map[0] >= 0 && map[1] <= srcLines.length) {
      tokens[idx].attrSet('data-mdt-source', srcLines.slice(map[0], map[1]).join('\n'));
    }
    return prevTable(tokens, idx, opts, env, self);
  };

  for (const name of ['td_open', 'th_open']) {
    const prev =
      md.renderer.rules[name] ||
      ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
    md.renderer.rules[name] = (tokens, idx, opts, env, self) => {
      let line = -1;
      let col = 0;
      for (let i = idx - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.type === 'td_open' || t.type === 'th_open') col++;
        else if (t.type === 'tr_open') {
          line = t.map ? t.map[0] : -1;
          break;
        } else if (t.type === 'table_open') break;
      }
      if (line >= 0 && line < srcLines.length) {
        const cells = splitTableRow(srcLines[line]);
        const raw = cells[col] ? cells[col].text.trim() : '';
        tokens[idx].attrSet('data-raw', raw);
      }
      return prev(tokens, idx, opts, env, self);
    };
  }
  return md;
}

// ---------------------------------------------------------------------------
// markdown table text utilities
// ---------------------------------------------------------------------------

function splitTableRow(text) {
  const cells = [];
  const n = text.length;
  const leadingPipe = text.match(/^ {0,3}\|/);
  let i = leadingPipe ? leadingPipe[0].length : 0;
  let start = i;
  for (; i < n; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '|') {
      cells.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  if ((start < n && text.slice(start).trim() !== '') || cells.length === 0) {
    cells.push({ start, end: n, text: text.slice(start, n) });
  }
  return cells;
}

function isTableLine(text) {
  return text.trim().length > 0 && text.includes('|');
}

function isDelimiterRow(text) {
  const cells = splitTableRow(text);
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c.text));
}

function findTableRange(doc, line) {
  let start = line;
  let end = line;
  while (start > 0 && isTableLine(doc.lineAt(start - 1).text)) start--;
  while (end + 1 < doc.lineCount && isTableLine(doc.lineAt(end + 1).text)) end++;
  return { start, end };
}

function linesOf(doc, range) {
  const out = [];
  for (let l = range.start; l <= range.end; l++) out.push(doc.lineAt(l).text);
  return out;
}

// 表編集の独自undoスタック（文書URIごと）。エディタのundo履歴を使わず
// WorkspaceEdit で静かに復元するため（フォーカスがちらつかない）
const undoStacks = new Map();
function stackFor(u) {
  const k = u.toString();
  if (!undoStacks.has(k)) undoStacks.set(k, { undo: [], redo: [], version: undefined });
  return undoStacks.get(k);
}

// ---------------------------------------------------------------------------
// 編集操作
// ---------------------------------------------------------------------------

// URIハンドラ経由で許可するop（外部リンクから来る可能性があるため編集系に限定。
// undo/redo/edit-state はwebview内専用）
const URI_OPS = new Set(['ping', 'edit-cell', 'insert-row', 'delete-row', 'insert-col', 'delete-col']);

async function handleOp(uri) {
  const q = new URLSearchParams(uri.query);
  const docUri = q.get('d');
  if (!docUri) throw new Error('document uri missing');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(docUri));
  const p = JSON.parse(q.get('p') || '{}');
  const op = uri.path.replace(/^\//, '');
  if (!URI_OPS.has(op)) throw new Error('op not allowed via uri: ' + op);
  log('uri op=' + op);
  await applyOp(doc, op, p);
  log('uri op done: ' + op);
}

// 外部入力(URIハンドラ/webview)からの編集要求を検証する。
// 対象行が「区切り行を持つ実際の表」の中にあることを確認しないと、
// | を含む普通の行や任意ファイルの行を書き換えられてしまう。
function assertTableContext(doc, line) {
  if (!Number.isInteger(line) || line < 0 || line >= doc.lineCount) {
    throw new Error('invalid line');
  }
  if (doc.languageId !== 'markdown') throw new Error('not a markdown file');
  let fence = null;
  for (let i = 0; i <= line; i++) {
    const match = doc.lineAt(i).text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) fence = { char: match[1][0], length: match[1].length };
    else if (match[1][0] === fence.char && match[1].length >= fence.length && /^\s*$/.test(match[2])) fence = null;
  }
  if (fence) throw new Error(t('codeBlock'));
  if (!isTableLine(doc.lineAt(line).text)) throw new Error('not a table line');
  const range = findTableRange(doc, line);
  if (range.start + 1 >= doc.lineCount || !isDelimiterRow(doc.lineAt(range.start + 1).text)) {
    throw new Error('not a table');
  }
  for (let i = range.start; i <= range.end; i++) {
    if (/^(?: {4}|\t)/.test(doc.lineAt(i).text)) throw new Error(t('indentedRow'));
  }
  return range;
}

function assertCol(col, cells) {
  if (!Number.isInteger(col) || col < 0 || col >= cells.length) {
    throw new Error('cell not found');
  }
}

async function saveIfConfigured(doc) {
  if (!vscode.workspace.getConfiguration('mdTableTools').get('autoSave')) return;
  try {
    if (await doc.save()) return;
  } catch (e) {
    log('save error: ' + e.message);
  }
  vscode.window.showWarningMessage(t('saveFailed'));
}

async function applyOp(doc, op, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid payload');
  if (op === 'ping') {
    vscode.window.showInformationMessage(t('connected'));
    return;
  }

  if (op === 'undo' || op === 'redo') {
    // 表編集のスナップショットで復元する独自undo。
    // エディタのundo履歴に頼るとフォーカスがソースへ切り替わってちらつくため、
    // WorkspaceEdit で直接復元する（スタックはプレビュー由来の編集のみ）
    const st = stackFor(doc.uri);
    if (st.version !== undefined && st.version !== doc.version) {
      throw new Error(t('historyDocumentChanged'));
    }
    const [src, dst] = op === 'undo' ? [st.undo, st.redo] : [st.redo, st.undo];
    const ent = src.pop();
    if (!ent) return; // 履歴なし
    const want = op === 'undo' ? ent.before : ent.after;
    const anchor = Math.min(ent.start, doc.lineCount - 1);
    const cur = findTableRange(doc, anchor);
    if (
      !isTableLine(doc.lineAt(anchor).text) ||
      cur.start + 1 >= doc.lineCount ||
      !isDelimiterRow(doc.lineAt(cur.start + 1).text)
    ) {
      src.push(ent); // 戻せないので履歴は消さない
      throw new Error(t('tableMissing'));
    }
    const curText = linesOf(doc, cur);
    const expected = op === 'undo' ? ent.after : ent.before;
    if (cur.start !== ent.start || curText.join('\n') !== expected.join('\n')) {
      src.push(ent);
      throw new Error(t('historyTableChanged'));
    }
    const edit2 = new vscode.WorkspaceEdit();
    edit2.replace(
      doc.uri,
      new vscode.Range(cur.start, 0, cur.end, doc.lineAt(cur.end).text.length),
      want.join('\n')
    );
    if (!(await vscode.workspace.applyEdit(edit2))) {
      src.push(ent);
      throw new Error(t('applyFailed'));
    }
    dst.push(ent);
    st.version = doc.version;
    await saveIfConfigured(doc);
    return;
  }

  if (['insert-row', 'delete-row', 'insert-col', 'delete-col'].includes(op)) {
    const range = assertTableContext(doc, p.line);
    if (typeof p.expectedTable !== 'string' || linesOf(doc, range).join('\n') !== p.expectedTable) {
      throw new Error(t('tableChanged'));
    }
  }

  const edit = new vscode.WorkspaceEdit();
  const u = doc.uri;
  const versionBefore = doc.version;
  // 変更系opの前に表全体をスナップショット（undoスタック用）
  let snapBefore = null;
  if (
    Number.isInteger(p.line) &&
    p.line >= 0 &&
    p.line < doc.lineCount &&
    isTableLine(doc.lineAt(p.line).text)
  ) {
    const r = findTableRange(doc, p.line);
    snapBefore = { start: r.start, lines: linesOf(doc, r) };
  }

  switch (op) {
    case 'edit-cell': {
      assertTableContext(doc, p.line);
      const lineText = doc.lineAt(p.line).text;
      const cells = splitTableRow(lineText);
      assertCol(p.col, cells);
      const c = cells[p.col];
      if (typeof p.text !== 'string' || typeof p.original !== 'string') throw new Error('invalid cell text');
      if (p.text.length > 10000) throw new Error(t('cellTooLong'));
      if (c.text.trim() !== p.original) throw new Error(t('cellChanged'));
      const safe = p.text
        .replace(/(\\*)\|/g, (_, slashes) => slashes + (slashes.length % 2 ? '' : '\\') + '|')
        .replace(/\r\n?|\n/g, '<br>');
      let ins = ' ' + safe + ' ';
      const w = c.end - c.start;
      if (ins.length < w) ins = ins.padEnd(w);
      edit.replace(u, new vscode.Range(p.line, c.start, p.line, c.end), ins);
      break;
    }
    case 'insert-row': {
      assertTableContext(doc, p.line);
      const lineText = doc.lineAt(p.line).text;
      const cols = splitTableRow(lineText).length;
      let at = p.before ? p.line : p.line + 1;
      const { start } = findTableRange(doc, p.line);
      if (at <= start + 1) at = start + 2;
      const blank = '| ' + Array(cols).fill(' ').join(' | ') + ' |';
      if (at >= doc.lineCount) {
        const lastLine = doc.lineAt(doc.lineCount - 1);
        edit.insert(u, lastLine.range.end, '\n' + blank);
      } else {
        edit.insert(u, new vscode.Position(at, 0), blank + '\n');
      }
      break;
    }
    case 'delete-row': {
      const { start } = assertTableContext(doc, p.line);
      if (p.line <= start + 1) throw new Error(t('cannotDeleteHeader'));
      const last = doc.lineCount - 1;
      const range =
        p.line < last
          ? new vscode.Range(p.line, 0, p.line + 1, 0)
          : new vscode.Range(p.line - 1, doc.lineAt(p.line - 1).text.length, p.line, doc.lineAt(p.line).text.length);
      edit.delete(u, range);
      break;
    }
    case 'insert-col': {
      const { start, end } = assertTableContext(doc, p.line);
      assertCol(p.col, splitTableRow(doc.lineAt(start).text));
      for (let l = start; l <= end; l++) {
        const text = doc.lineAt(l).text;
        const cells = splitTableRow(text);
        if (cells.length === 0) continue;
        const idx = p.before ? p.col : p.col + 1;
        const core = isDelimiterRow(text) ? '---' : ' ';
        let pos;
        let ins;
        if (idx < cells.length) {
          pos = cells[idx].start;
          ins = ' ' + core + ' |';
        } else {
          const lastCell = cells[cells.length - 1];
          if (lastCell.end < text.length && text[lastCell.end] === '|') {
            pos = lastCell.end + 1;
            ins = ' ' + core + ' |';
          } else {
            pos = text.length;
            ins = ' | ' + core;
          }
        }
        edit.insert(u, new vscode.Position(l, pos), ins);
      }
      break;
    }
    case 'delete-col': {
      const { start, end } = assertTableContext(doc, p.line);
      const headerCells = splitTableRow(doc.lineAt(start).text);
      if (headerCells.length <= 1) throw new Error(t('cannotDeleteLastColumn'));
      assertCol(p.col, headerCells);
      for (let l = start; l <= end; l++) {
        const text = doc.lineAt(l).text;
        const cells = splitTableRow(text);
        if (p.col >= cells.length) continue;
        const c = cells[p.col];
        let s = c.start;
        let e = c.end;
        if (s > 0 && text[s - 1] === '|') s = s - 1;
        else if (e < text.length && text[e] === '|') e = e + 1;
        edit.delete(u, new vscode.Range(l, s, l, e));
      }
      break;
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  log('applyEdit result=' + ok);
  if (!ok) throw new Error(t('applyFailed'));

  // undo履歴に記録（編集後の表をスナップしてredoに使う）
  if (snapBefore) {
    const st = stackFor(u);
    if (st.version !== undefined && st.version !== versionBefore) {
      st.undo = [];
      st.redo = [];
    }
    const after = findTableRange(doc, snapBefore.start);
    st.undo.push({
      start: snapBefore.start,
      before: snapBefore.lines,
      after: linesOf(doc, after),
    });
    if (st.undo.length > 100) st.undo.shift();
    st.redo = [];
    st.version = doc.version;
  }

  // 編集後にエディタを再表示して強制再描画（黒画面対策）
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document.uri.toString() === u.toString()) {
      try {
        await vscode.window.showTextDocument(doc, {
          viewColumn: ed.viewColumn,
          preserveFocus: true,
          preview: true,
        });
      } catch {}
    }
  }

  await saveIfConfigured(doc);
}

module.exports = { activate, deactivate, _test: { splitTableRow, isDelimiterRow, assertTableContext, applyOp, handleOpMsg } };
