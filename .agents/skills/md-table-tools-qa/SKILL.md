---
name: md-table-tools-qa
description: Markdown Table Tools を実際の VS Code で操作・検証し、画面録画からデモ GIF を制作または再生成するときに使う。標準 Markdown プレビューとの比較と配布用 VSIX の検証にも使う。
---

# 実 VS Code での検証とデモ制作

## 実機での操作と検証

1. `AGENTS.md` と作業ツリー、`docs/verification.md` を確認する。検証用の一時フォルダーに `test/fixtures/demo.md` と同じフォルダーに置く `test/fixtures/icon.png` をコピーし、元のサンプルを直接編集しない。
2. 対象の開発版または VSIX を実 VS Code に読み込む。画面操作が必要なら、利用可能な `computer-use` スキルの手順に従って対象ウィンドウを選び、画面を確認しながら操作する。操作前後の画面だけでなく、保存された Markdown の内容でも結果を確かめる。
3. 同じ文書を標準 Markdown プレビューと本拡張のプレビューで開き、表、Mermaid、KaTeX、画像、リンクの表示と双方向スクロールを比較する。標準プレビューに依存する拡張や実行環境を記録する。
4. 検証目的に応じて、セルの直接編集と Tab 移動、ソート・フィルタ、行列追加・削除、Undo/Redo、保存を実際に操作する。表以外の Markdown が維持されるか確認する。編集競合や取得元データがない場合の処理は、対応する自動テストでも確認する。
5. `docs/verification.md` に環境、操作、確認結果、証拠、未実施項目を区別して記録する。実画面を操作できなければ Extension Host などで検証できる範囲を確認し、画面操作の代替として成功扱いにしない。

## 実操作の録画と GIF

- 対象の VS Code を前面に表示し、通知や他のウィンドウ、個人情報が録画に入らないようにする。確認済みのデモ用文書と実際の拡張を使う。
- 次の3シナリオをそれぞれ実操作する。①セルの直接編集と Tab 移動、②ソート・フィルタ・行列操作、③Mermaid・KaTeX・画像とエディタ／プレビュー間のスクロール同期。③は両ペインが見えるよう録画する。未検証の操作は収録しない。
- `docs/demo-capture.md` の `ffmpeg` / `gdigrab` の手順に従い、実画面を15fps・音声なしの動画として `test/.run/` に録画する。画面位置と録画時間は実際のウィンドウに合わせる。
- 録画を確認して待ち時間を除いた区間を決め、`tools/video-to-gif.py` と `docs/demo-capture.md` の変換例を使って切り出し、`images/demo-edit.gif`、`images/demo-operations.gif`、`images/demo-preview.gif` を生成する。区間や範囲は録画ごとに調整する。
- 生成後に全シーン、ループ、読みやすさと容量を確認し、README の参照先も確認する。公開後に各ストアの画像表示を確認する場合は、その結果を記録する。録画操作と切り出し時間の自動化は現状未実装。

## 自動テストと配布

変更に応じて `npm test`、`npm run test:integration` を実行する。配布前には VSIX を作成し、`npm run test:vsix -- <VSIXのパス>` で実際の配布物をインストールして検証する。CI・公開設定を変更する場合は、`.github/workflows/test.yml` と `.github/workflows/release.yml` で検証対象と公開対象が一致することを確認する。

標準プレビューの表示を優先し、元データを取得できない場合や編集競合がある場合は安全に編集を停止する。main へのマージと新バージョンの公開は、利用者の明示的な承認を得てから行う。
