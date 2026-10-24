// Markdown Table Tools — markdown preview injection script
// 標準プレビュー内で動作。ソート/フィルタはDOM内で完結、
// 編集系は vscode://<拡張ID>/<op> リンククリック経由で拡張ホストへ送る。
(function () {
  'use strict';
  if (window.__mdt) return;
  window.__mdt = true;

  const EXT_ID = 'local.md-table-tools'; // publisher.name (URI fallback 用)
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

  // セル→ソース行。td/tr の data-line 優先、なければ table起点+行オフセット
  function lineOf(cell) {
    let l = numAttr(cell, 'data-line');
    if (l >= 0) return l;
    const tr = cell.parentElement;
    l = numAttr(tr, 'data-line');
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
    if (!table.tHead || !table.tHead.rows.length) return;
    const s = st(idx);
    const headRow = table.tHead.rows[0];
    const cols = headRow.cells.length;
    table.dataset.mdt = '1';
    table.classList.add('mdt');

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

    // ソート解除時の復元用に現在順序を刻印
    dataRows(table).forEach((r, i) => {
      if (r.dataset.mdtIdx === undefined) r.dataset.mdtIdx = i;
    });

    applySort(table, s);
    markSort(table, s);
    applyFilter(table, s);
  }

  function enhanceAll() {
    const list = Array.from(document.querySelectorAll('table'));
    list.forEach((t, i) => enhance(t, i));
  }

  // ---- cell edit ---------------------------------------------------------------

  let editing = null;

  // data-raw が無い場合のフォールバック: 表示HTMLから<br>を改行に戻したテキストを得る
  function cellRawText(cell) {
    const tmp = document.createElement('div');
    tmp.innerHTML = cell.innerHTML.replace(/<br\s*\/?>/gi, '\n');
    return tmp.textContent;
  }

  function startEdit(cell) {
    const tr = cell.parentElement;
    if (!tr || tr.classList.contains('mdt-filter-row')) return;
    const line = lineOf(cell);
    if (line < 0) return;
    const col = colOf(cell);
    const src = cell.dataset.raw !== undefined ? cell.dataset.raw : cellRawText(cell);
    const raw = src.replace(/<br\s*\/?>/gi, '\n');
    if (editing) editing.commit();

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
      const v = input.value.replace(/\r\n/g, '\n');
      const out = v.replace(/\n/g, '<br>');
      cell.classList.remove('mdt-editing');
      if (commit && out !== src) {
        // 再描画までの暫定表示（改行は<br>として見せる）
        const esc = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        cell.innerHTML = esc.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\n/g, '<br>');
        send('edit-cell', { line, col, text: out });
      } else {
        cell.innerHTML = savedHtml;
      }
    };
    editing = { commit: () => finish(true) };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) finish(true);
      else if (e.key === 'Escape') finish(false);
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

    const items = [];
    items.push({ label: 'セルを編集', fn: () => startEdit(cell) });
    if (inBody) {
      items.push({ label: '行を上に追加', fn: () => send('insert-row', { line, before: true }) });
      items.push({ label: '行を下に追加', fn: () => send('insert-row', { line, before: false }) });
      items.push({ label: '行を削除', fn: () => send('delete-row', { line }) });
    }
    items.push({ label: '列を左に追加', fn: () => send('insert-col', { line, col, before: true }) });
    items.push({ label: '列を右に追加', fn: () => send('insert-col', { line, col, before: false }) });
    items.push({ label: '列を削除', fn: () => send('delete-col', { line, col }) });
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
