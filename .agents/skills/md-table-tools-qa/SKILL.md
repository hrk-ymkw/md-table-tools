---
name: md-table-tools-qa
description: Markdown Table Tools の VS Code 拡張を変更、検証、リリース準備するときに使う。標準 Markdown プレビューとの互換性、表編集の安全性、Extension Host と VSIX のテスト、実画面のデモを扱う。
---

# Markdown Table Tools の検証

## 方針

- 作業前に `AGENTS.md`、Git の変更状況、関連する実装とテストを確認する。既存の変更を保持する。
- 標準 Markdown プレビューの描画を優先し、独自レンダラーの再実装を避ける。`extension.js` の Markdown API・プレビュー素材への依存と `media/preview.js` の操作を調べる。
- 表外の Markdown とセルの元データを保持する。元データを取得できない場合や競合時は、安全に編集を停止する。Undo/Redo や行列操作でも文書の整合性を確認する。

## 検証

1. 変更に応じて `npm test` を実行し、対象のテストを追加・更新する。
2. VS Code の連携を変更する場合は `npm run test:integration` を実行する。配布前は `npm run package -- --out extension.vsix` で VSIX を作り、`npm run test:vsix -- extension.vsix` でその配布物をインストールして検証する。
3. 画面表示や操作の確認が必要なら実 VS Code を使い、標準プレビューと比較する。環境、確認した操作、未検証の項目を区別して `docs/verification.md` に記録する。実施できなかった検証を成功扱いにしない。
4. デモの録画と GIF 変換は `docs/demo-capture.md` を参照する。実際に動作確認した操作だけを収録し、個人情報を映さない。
5. CI や公開設定の変更時は `.github/workflows/test.yml` と `.github/workflows/release.yml` を確認し、テスト済み VSIX と公開対象が一致することを確かめる。

main へのマージと新バージョンの公開は、利用者の明示的な承認を得てから行う。
