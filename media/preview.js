// Markdown Table Tools — markdown preview injection script
// 標準プレビュー内で動作。ソート/フィルタはDOM内で完結、
// 編集系は vscode://<拡張ID>/<op> リンククリック経由で拡張ホストへ送る。
(function () {
  'use strict';
  if (window.__mdt) return;
  window.__mdt = true;

  const EXT_ID = 'hrk-ymkw.md-table-tools'; // publisher.name (URI fallback 用)
  const states = new Map(); // tableIndex -> { sort:{col,dir}, filters:[], origRows:[] }

  // 標準プレビュー内かどうか: 自作パネルだけ #mdt-body を持つ
  // （自作パネルにも本体互換の #vscode-markdown-preview-data があるため id では判定しない）
  const inBuiltinPreview = !document.getElementById('mdt-body');
  let api = null;
  if (!inBuiltinPreview) {
    // 本体プレビュースクリプトとAPIを共有するため acquireVsCodeApi をラップしておく
    // （後から読み込まれる本体scriptが呼んでも同じインスタンスが返る）
    const origAcquire = window.acquireVsCodeApi;
    window.acquireVsCodeApi = function () {
      if (!api) api = origAcquire();
      return api;
    };
    try {
      api = window.acquireVsCodeApi();
    } catch {
      api = null;
    }
  }
  // 自作パネル: #vscode-markdown-preview-data の data-settings からdoc URIを取る（本体scriptと同じ場所）
  let docSource = inBuiltinPreview ? '' : docUri();

  // 本体scriptが要求するプレビューシェル側グローバル（標準HTMLは本体が注入する）
  // こちらは無いので最小実装を提供。CSP違反は拡張ホストのログへ流す。
  if (!inBuiltinPreview) {
    if (!window.cspAlerter) {
      window.cspAlerter = {
        setPoster(poster) {
          document.addEventListener('securitypolicyviolation', (e) => {
            try {
              poster.postMessage('cspViolation', {
                blockedUri: e.blockedURI,
                directive: e.violatedDirective,
              });
            } catch {
              if (api) api.postMessage({ op: 'log', text: 'CSP blocked: ' + e.blockedURI });
            }
          });
        },
      };
    }
    if (!window.styleLoadingMonitor) {
      window.styleLoadingMonitor = { setPoster() {} };
    }
  }

  // 標準プレビューでは書き戻し経路が無い(CSPで外部スキーム遷移も封鎖)ため閲覧機能のみ
  document.body.classList.toggle('mdt-readonly', inBuiltinPreview);

  window.addEventListener('error', (e) => {
    if (api) {
      api.postMessage({ op: 'log', text: 'webview error: ' + e.message + ' @' + (e.filename || '') + ':' + (e.lineno || '') });
    }
  });

  // ---- utils ---------------------------------------------------------------

  function docUri() {
    const el = document.getElementById('vscode-markdown-preview-data');
    if (!el) return '';
    try {
      return JSON.parse(el.dataset.settings).source || '';
    } catch {
      return '';
    }
  }

  function uriScheme() {
    const t = document.querySelector('table[data-mdt-scheme]');
    return (t && t.dataset.mdtScheme) || 'vscode';
  }

  function send(op, payload) {
    if (api) {
      api.postMessage({ op, d: docSource, p: payload || {} });
      return;
    }
    const d = docUri();
    if (!d) return;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href =
      uriScheme() +
      '://' +
      EXT_ID +
      '/' +
      op +
      '?d=' +
      encodeURIComponent(d) +
      '&p=' +
      encodeURIComponent(JSON.stringify(payload || {}));
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function numAttr(el, name) {
    if (!el) return -1;
    const v = el.getAttribute(name);
    const n = v ? parseInt(v, 10) : NaN;
    return isNaN(n) ? -1 : n;
  }

  function dataRows(table) {
    const tb = table.tBodies[0];
    return tb ? Array.from(tb.rows) : [];
  }

  // セル→ソース行。ソートでDOM順がズレるため、enhance時（DOMがソース順の瞬間）に
  // 各行へ data-mdt-line を刻印しておき、それを優先する
  function lineOf(cell) {
    let l = numAttr(cell, 'data-line');
    if (l >= 0) return l;
    const tr = cell.parentElement;
    l = numAttr(tr, 'data-line');
    if (l >= 0) return l;
    l = numAttr(tr, 'data-mdt-line');
    if (l >= 0) return l;
    const table = cell.closest('table');
    l = numAttr(table, 'data-line');
    if (l >= 0) {
      if (tr.parentElement === table.tHead) return l;
      const idx = dataRows(table).indexOf(tr);
      if (idx >= 0) return l + 2 + idx;
    }
    return -1;
  }

  function colOf(cell) {
    return Array.prototype.indexOf.call(cell.parentElement.cells, cell);
  }

  // ---- sort / filter ---------------------------------------------------------

  function st(idx) {
    if (!states.has(idx)) states.set(idx, { sort: { col: -1, dir: 0 }, filters: {}, origRows: [] });
    return states.get(idx);
  }

  function cellText(table, row, col) {
    const c = row.cells[col];
    return c ? c.textContent.trim() : '';
  }

  function applySort(table, s) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = dataRows(table);
    if (s.sort.col < 0) {
      // 元の順序（data-mdtIdx）に戻す
      rows.sort(
        (a, b) =>
          (a.dataset.mdtIdx !== undefined ? +a.dataset.mdtIdx : 9999) -
          (b.dataset.mdtIdx !== undefined ? +b.dataset.mdtIdx : 9999)
      );
    } else {
      const col = s.sort.col;
      rows.sort((a, b) => {
        const at = cellText(table, a, col);
        const bt = cellText(table, b, col);
        const an = parseFloat(at);
        const bn = parseFloat(bt);
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : at.localeCompare(bt, 'ja');
        return s.sort.dir === 1 ? cmp : -cmp;
      });
    }
    // 実際に順序が変わる行だけDOMを動かす（無駄なmutationを避ける）
    for (let i = 0; i < rows.length; i++) {
      if (tbody.children[i] !== rows[i]) {
        tbody.insertBefore(rows[i], tbody.children[i] || null);
      }
    }
  }

  function applyFilter(table, s) {
    for (const row of dataRows(table)) {
      let show = true;
      for (const c in s.filters) {
        const f = s.filters[c];
        if (f && !cellText(table, row, +c).toLowerCase().includes(f.toLowerCase())) {
          show = false;
          break;
        }
      }
      row.style.display = show ? '' : 'none';
    }
  }

  function markSort(table, s) {
    const headRow = table.tHead && table.tHead.rows[0];
    if (!headRow) return;
    for (const th of headRow.cells) {
      th.classList.remove('mdt-asc', 'mdt-desc');
    }
    if (s.sort.col >= 0 && headRow.cells[s.sort.col]) {
      headRow.cells[s.sort.col].classList.add(s.sort.dir === 1 ? 'mdt-asc' : 'mdt-desc');
    }
  }

  // ---- table enhancement -----------------------------------------------------

  function enhance(table, idx) {
    // 編集中セルを含む表は丸ごとスキップ:
    // セルを空にしてtextareaを置いた直後に sort(行移動)/filter(非表示)/再刻印が
    // 走ると textarea が blur して即コミット＆刻印がソート順位で腐敗する
    if (editingCell && table.contains(editingCell)) return;
    if (!table.tHead || !table.tHead.rows.length) return;
    const s = st(idx);
    const headRow = table.tHead.rows[0];
    const cols = headRow.cells.length;
    table.dataset.mdt = '1';
    table.classList.add('mdt');

    // 列数が変わると以前の列番号は別の列を指すため、表示条件を解除する。
    if (s.colCount !== undefined && s.colCount !== cols) {
      s.sort = { col: -1, dir: 0 };
      s.filters = {};
      const oldFilterRow = table.tHead.querySelector('tr.mdt-filter-row');
      if (oldFilterRow) oldFilterRow.remove();
    }
    s.colCount = cols;

    // フィルタ行（再描画で消えていたら再追加）
    let fr = table.tHead.querySelector('tr.mdt-filter-row');
    if (!fr) {
      fr = document.createElement('tr');
      fr.className = 'mdt-filter-row';
      for (let c = 0; c < cols; c++) {
        const th = document.createElement('th');
        const inp = document.createElement('input');
        inp.className = 'mdt-filter';
        inp.type = 'text';
        inp.dataset.col = c;
        inp.value = s.filters[c] || '';
        inp.addEventListener('input', () => {
          s.filters[c] = inp.value;
          applyFilter(table, s);
        });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('click', (e) => e.stopPropagation());
        th.appendChild(inp);
        fr.appendChild(th);
      }
      table.tHead.appendChild(fr);
    }

    // 行の元情報を刻印。この時点のDOMはmorphdom直後＝ソース順なので
    // 現在順位 = ソース上の位置として正しい（ソート適用前に必ず上書きする）
    const baseLine = numAttr(table, 'data-line');
    dataRows(table).forEach((r, i) => {
      r.dataset.mdtIdx = i;
      const trLine = numAttr(r, 'data-line');
      r.dataset.mdtLine =
        trLine >= 0 ? trLine : baseLine >= 0 ? baseLine + 2 + i : '';
    });

    applySort(table, s);
    markSort(table, s);
    applyFilter(table, s);
  }

  function enhanceAll() {
    const list = Array.from(document.querySelectorAll('table'));
    list.forEach((t, i) => enhance(t, i));
    restoreSelected();
  }

  // ---- cell edit ---------------------------------------------------------------

  let editing = null;
  let editingCell = null; // 編集中セル。この表の sort/filter/再刻印を停止するための目印
  let selectedCell = null; // 矢印キー移動の選択セル
  let selKey = null; // 再描画後に選択を復元するための {line, col}

  function setSelected(cell, scroll = true) {
    if (selectedCell) selectedCell.classList.remove('mdt-selected');
    selectedCell = cell || null;
    if (selectedCell) {
      selectedCell.classList.add('mdt-selected');
      selKey = { line: lineOf(selectedCell), col: colOf(selectedCell) };
      if (scroll) selectedCell.scrollIntoView({ block: 'nearest' });
    } else {
      selKey = null;
    }
  }

  // morphdom再描画で選択セルのDOMが置き換わったとき、行/列から選び直す
  function restoreSelected() {
    if (selectedCell && document.contains(selectedCell)) return;
    selectedCell = null;
    if (!selKey || selKey.line < 0) return;
    for (const table of document.querySelectorAll('table.mdt')) {
      const tb = table.tBodies[0];
      if (!tb) continue;
      for (const tr of tb.rows) {
        const td = tr.cells[selKey.col];
        if (td && lineOf(td) === selKey.line) {
          setSelected(td, false);
          return;
        }
      }
    }
  }

  // dx/dy方向の隣接セル（フィルタ行・非表示行は飛ばす）
  function cellAt(cell, dx, dy) {
    const tr = cell.parentElement;
    const table = cell.closest('table');
    if (!tr || !table) return null;
    const col = colOf(cell);
    if (dx) return tr.cells[col + dx] || null;
    const rows = Array.from(table.rows);
    let i = rows.indexOf(tr);
    while (true) {
      i += dy;
      if (i < 0 || i >= rows.length) return null;
      const r = rows[i];
      if (r.classList.contains('mdt-filter-row')) continue;
      if (r.style.display === 'none') continue;
      return r.cells[col] || null;
    }
  }

  // Tab移動先。行端では次/前の表示行の端へ折り返す
  function tabNext(cell, dir) {
    let next = cellAt(cell, dir, 0);
    if (!next) {
      const table = cell.closest('table');
      const rows = Array.from(table.rows);
      const idx = rows.indexOf(cell.parentElement);
      for (let i = idx + dir; i >= 0 && i < rows.length; i += dir) {
        const r = rows[i];
        if (r.classList.contains('mdt-filter-row') || r.style.display === 'none') continue;
        next = dir < 0 ? r.cells[r.cells.length - 1] : r.cells[0];
        break;
      }
    }
    return next;
  }

  function startEdit(cell) {
    const tr = cell.parentElement;
    if (!tr || tr.classList.contains('mdt-filter-row')) return;
    const line = lineOf(cell);
    if (line < 0) return;
    const col = colOf(cell);
    // 表示文字列からMarkdownを再構成するとリンク等の書式を失うため編集しない。
    if (cell.dataset.raw === undefined) {
      if (api) api.postMessage({ op: 'edit-unavailable' });
      return;
    }
    const src = cell.dataset.raw;
    const raw = src.replace(/<br\s*\/?>/gi, '\n');
    if (editing) editing.commit();
    editingCell = cell; // DOM変更(空にする)より先に立てて enhance を止める
    setSelected(cell);
    send('edit-state', { active: true }); // ホストへ編集中を通知（再描画を保留させる）

    const savedHtml = cell.innerHTML;
    cell.classList.add('mdt-editing');
    cell.textContent = '';
    const input = document.createElement('textarea');
    input.className = 'mdt-cell-input';
    input.value = raw;
    cell.appendChild(input);
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    };
    input.addEventListener('input', resize);
    resize();
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      editing = null;
      editingCell = null;
      // 別セルの編集がこの直後に始まる場合があるので、同期ではなく
      // マイクロタスク後に「編集が続いていなければ」ホストへ再描画再開を通知する
      setTimeout(() => {
        if (!editingCell) send('edit-state', { active: false });
      }, 0);
      const v = input.value.replace(/\r\n/g, '\n');
      const out = v.replace(/\n/g, '<br>');
      cell.classList.remove('mdt-editing');
      if (commit && out !== src) {
        // 再描画までの暫定表示（改行は<br>として見せる）
        const esc = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        cell.innerHTML = esc.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\n/g, '<br>');
        send('edit-cell', { line, col, text: out, original: src });
      } else {
        cell.innerHTML = savedHtml;
      }
    };
    editing = { commit: () => finish(true) };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) finish(true);
      else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') {
        // 確定して隣接セルの編集へ。行端では次/前の表示行の端へ折り返す
        e.preventDefault();
        const next = tabNext(cell, e.shiftKey ? -1 : 1);
        finish(true);
        if (next) startEdit(next);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // ---- context menu --------------------------------------------------------------

  let menu = null;
  function closeMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function openMenu(x, y, cell) {
    closeMenu();
    const table = cell.closest('table');
    const tr = cell.parentElement;
    const inBody = tr.parentElement !== table.tHead;
    const line = lineOf(cell);
    const col = colOf(cell);
    const expectedTable = table.dataset.mdtSource;

    const items = [];
    items.push({ label: 'セルを編集', fn: () => startEdit(cell) });
    if (inBody) {
      items.push({ label: '行を上に追加', fn: () => send('insert-row', { line, before: true, expectedTable }) });
      items.push({ label: '行を下に追加', fn: () => send('insert-row', { line, before: false, expectedTable }) });
      items.push({ label: '行を削除', fn: () => send('delete-row', { line, expectedTable }) });
    }
    items.push({ label: '列を左に追加', fn: () => send('insert-col', { line, col, before: true, expectedTable }) });
    items.push({ label: '列を右に追加', fn: () => send('insert-col', { line, col, before: false, expectedTable }) });
    items.push({ label: '列を削除', fn: () => send('delete-col', { line, col, expectedTable }) });
    items.push({ label: '接続テスト', fn: () => send('ping', {}) });

    menu = document.createElement('div');
    menu.className = 'mdt-menu';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        it.fn();
      });
      menu.appendChild(b);
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
  }

  // ---- global listeners ---------------------------------------------------------

  document.addEventListener(
    'click',
    (e) => {
      if (menu && menu.contains(e.target)) return; // メニュー内クリックはボタン側で処理
      closeMenu();
      // 表の外をクリックしたら選択解除（青い枠を消す）
      if (!e.target.closest('table.mdt')) setSelected(null);
      const th = e.target.closest('th');
      if (th) {
        const table = th.closest('table');
        if (!table || !table.classList.contains('mdt')) return;
        const headRow = table.tHead && table.tHead.rows[0];
        if (!headRow || th.parentElement !== headRow) return; // フィルタ行などは除外
        const idx = Array.from(document.querySelectorAll('table')).indexOf(table);
        const s = st(idx);
        const col = colOf(th);
        if (s.sort.col !== col) {
          s.sort.col = col;
          s.sort.dir = 1;
        } else if (s.sort.dir === 1) {
          s.sort.dir = -1;
        } else {
          s.sort.col = -1;
          s.sort.dir = 0;
        }
        applySort(table, s);
        markSort(table, s);
        applyFilter(table, s);
        return;
      }
      const td = e.target.closest('td');
      if (api && td && td.closest('table') && td.closest('table').classList.contains('mdt')) {
        if (e.target.closest('a')) return;
        if (td.classList.contains('mdt-editing')) return;
        startEdit(td);
      }
    },
    true
  );

  document.addEventListener(
    'contextmenu',
    (e) => {
      const cell = e.target.closest('td,th');
      if (!cell || !api) return; // 標準プレビューでは書き戻し不能なのでメニューは出さない
      const table = cell.closest('table');
      if (!table || !table.classList.contains('mdt')) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, cell);
    },
    true
  );

  // 本体スクリプト（自作パネル/標準プレビュー共通）がDOMパッチ後に発火するイベント
  // → テーブルUIを再適用する
  window.addEventListener('vscode.markdown.updateContent', () => {
    try {
      enhanceAll();
    } catch (e) {
      if (api) api.postMessage({ op: 'log', text: 'enhanceAll error: ' + e.message });
    }
  });

  // 自作パネルからの更新メッセージ / スクロール要求
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mdt-update') {
      docSource = m.source;
      // 本体スクリプトが .markdown-body を描画済みならパッチに任せる（二重描画しない）
      // 自分のdivは id=mdt-body で区別（本体は querySelector('.markdown-body') の先頭を使うため、
      // こちらには markdown-body クラスを初期状態では持たせない）
      if (document.querySelector('.markdown-body:not(#mdt-body)')) return;
      const body = document.getElementById('mdt-body');
      if (body) {
        body.className = 'markdown-body'; // フォールバック描画時のみクラス付与
        body.innerHTML = m.html;
        window.dispatchEvent(new Event('vscode.markdown.updateContent'));
      }
    } else if (m.type === 'mdt-scrollTo') {
      const el = document.getElementById(m.id);
      if (el) el.scrollIntoView();
    }
  });

  // セル選択・キーボード移動（スプレッドシート風）
  // 未選択時は矢印キーを横取りせずページスクロールに任せる
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea')) return;
    if (selectedCell && !document.contains(selectedCell)) selectedCell = null;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dirs[e.key];
    if (d) {
      if (!selectedCell) return; // ページスクロール
      e.preventDefault();
      const next = cellAt(selectedCell, d[0], d[1]);
      if (next) setSelected(next);
      return;
    }
    if (e.key === 'Enter' && selectedCell && !editingCell) {
      e.preventDefault();
      startEdit(selectedCell);
      return;
    }
    // 非編集中のTabは選択移動だけ（編集中のTab移動はtextarea側が担当）
    if (e.key === 'Tab' && selectedCell && !editingCell) {
      e.preventDefault();
      const next = tabNext(selectedCell, e.shiftKey ? -1 : 1);
      if (next) setSelected(next);
    }
  });

  // Ctrl+Z / Ctrl+Y: ソース文書の編集履歴を戻す/やり直す
  // （入力欄の中はネイティブのundoに任せる）
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !api) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea')) return;
    e.preventDefault();
    send(k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : 'redo', {});
  });

  // プレビュー再描画(morphdom)で注入UIが消えるので再適用する
  let timer = null;
  function scheduleEnhance() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        enhanceAll();
      } catch (e) {
        if (api) api.postMessage({ op: 'log', text: 'enhanceAll error: ' + e.message });
      }
    }, 30);
  }
  function touchesTable(nodes) {
    for (const n of nodes) {
      if (n.nodeType === 1 && (n.tagName === 'TABLE' || (n.querySelector && n.querySelector('table')))) {
        return true;
      }
    }
    return false;
  }
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      if (m.target && m.target.closest && m.target.closest('table')) {
        scheduleEnhance();
        return;
      }
      if (touchesTable(m.addedNodes) || touchesTable(m.removedNodes)) {
        scheduleEnhance();
        return;
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  enhanceAll();

  // 自作パネル側: 初期描画要求を送る（拡張が投げる初回postMessageはロード前だと届かないため）
  if (api) {
    api.postMessage({ op: 'ready' });
  }
})();
