# Markdown Table Tools

Markdownファイルを全画面プレビューしながら、表を直接編集できる拡張機能です。

## 使い方

Markdownファイルを開いた状態で `Ctrl+Alt+V`（Mac: `Cmd+Alt+V`）を押すか、
コマンドパレットから「テーブルプレビューを開く」を実行します。

## 機能

- **セルの直接編集**: プレビュー内の表のセルをクリックして編集
- **行・列の追加/削除**: 表を右クリックしてコンテキストメニューから操作
- **ソート**: ヘッダークリックで昇順/降順を切り替え
- **列フィルタ**: ヘッダー下の入力欄で絞り込み（表示のみ、ソースは変更しません）
- **自動保存**: 編集は既定で自動保存されます
- **標準プレビュー相当の表示**: Mermaid・数式(KaTeX)・相対画像・リンクをサポート
- **スクロール同期**: エディタとプレビューが双方向に追従します

## 設定

| 設定 | 既定 | 説明 |
|---|---|---|
| `mdTableTools.autoSave` | `true` | 表の編集を自動保存する |
| `mdTableTools.openIn` | `"active"` | `"beside"` で横並び表示に変更 |

スクロール同期は標準プレビューと同じ設定（`markdown.preview.scrollEditorWithPreview` /
`markdown.preview.scrollPreviewWithEditor`）に従います。

## 動作環境

VS Code 系IDE（VS Code / Windsurf / Devin Desktop 等）を想定しています。
Mermaid・数式・標準スタイルはIDE同梱のMarkdown関連拡張の資産を再利用するため、
それらが同梱されていない環境では簡易表示になります。

## ライセンス

MIT
