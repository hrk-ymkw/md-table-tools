// Shared by the extension host and Markdown preview webviews.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.mdtI18n = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const en = {
    "openMarkdown": "Open a Markdown file first.",
    "missingSource": "Cell editing stopped because the original Markdown could not be retrieved.",
    "documentChanged": "The preview document has changed.",
    "codeBlock": "Cannot edit inside a code block.",
    "indentedRow": "Editing stopped because the table contains indented rows.",
    "saveFailed": "Could not auto-save. Check the document and save it manually.",
    "connected": "MD Table Tools: Connection successful.",
    "historyDocumentChanged": "History restoration stopped because the document has changed.",
    "tableMissing": "The table could not be found. The document has changed significantly.",
    "historyTableChanged": "History restoration stopped because the table has changed.",
    "applyFailed": "Could not apply the edit.",
    "tableChanged": "The operation stopped because the table has changed.",
    "cellTooLong": "Editing stopped because the cell content is too long.",
    "cellChanged": "Editing stopped because the cell has changed.",
    "cannotDeleteHeader": "Cannot delete the header or separator row.",
    "cannotDeleteLastColumn": "Cannot delete the last column.",
    "editCell": "Edit Cell",
    "insertRowAbove": "Insert Row Above",
    "insertRowBelow": "Insert Row Below",
    "deleteRow": "Delete Row",
    "insertColumnLeft": "Insert Column Left",
    "insertColumnRight": "Insert Column Right",
    "deleteColumn": "Delete Column",
    "testConnection": "Test Connection",
    "previewTitle": "Preview: {0}",
    "previewPageTitle": "Markdown Table Preview",
    "filterColumn": "Filter column {0}"
  };
  const ja = {
    "openMarkdown": "Markdownファイルを開いた状態で実行してください",
    "missingSource": "元のMarkdownを取得できないため、セルの編集を停止しました。",
    "documentChanged": "プレビューの文書が変更されています",
    "codeBlock": "コードブロック内は編集できません",
    "indentedRow": "インデントされた行を含むため、編集を停止しました",
    "saveFailed": "自動保存できませんでした。文書の状態を確認して保存してください。",
    "connected": "MD Table Tools: 接続OKです",
    "historyDocumentChanged": "文書が変更されたため、履歴の復元を停止しました",
    "tableMissing": "対象の表が見つかりません（文書が大きく変更されています）",
    "historyTableChanged": "表が変更されたため、履歴の復元を停止しました",
    "applyFailed": "編集の適用に失敗しました",
    "tableChanged": "表が変更されたため、操作を停止しました",
    "cellTooLong": "セルの内容が長すぎるため、編集を停止しました",
    "cellChanged": "セルが変更されたため、編集を停止しました",
    "cannotDeleteHeader": "ヘッダー行/区切り行は削除できません",
    "cannotDeleteLastColumn": "最後の列は削除できません",
    "editCell": "セルを編集",
    "insertRowAbove": "行を上に追加",
    "insertRowBelow": "行を下に追加",
    "deleteRow": "行を削除",
    "insertColumnLeft": "列を左に追加",
    "insertColumnRight": "列を右に追加",
    "deleteColumn": "列を削除",
    "testConnection": "接続テスト",
    "previewTitle": "プレビュー: {0}",
    "previewPageTitle": "Markdown テーブルプレビュー",
    "filterColumn": "列 {0} を絞り込み"
  };
  function language(locale) {
    return /^ja(?:-|$)/i.test(locale || '') ? 'ja' : 'en';
  }
  function createTranslator(locale) {
    const messages = language(locale) === 'ja' ? ja : en;
    return (key, ...args) => (messages[key] || en[key] || key)
      .replace(/\{(\d+)\}/g, (match, index) => args[index] === undefined ? match : String(args[index]));
  }
  return { language, createTranslator };
});
