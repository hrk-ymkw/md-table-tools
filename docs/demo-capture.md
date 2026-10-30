# デモGIFの再生成

3本のGIFは、実際の VS Code 操作をカーソル付きの動画として録画し、必要な区間を切り出して作る。静止画をつないで動画の代わりにしない。画面操作は computer-use で行い、録画範囲と切り出し時間は、その都度映像を見て決める。

## 事前確認

1. `npm run test:e2e` を実行する。セル編集・Tab・ソート・フィルタ・行列操作と保存結果は `test/e2e/run.js` のシナリオを共有する。失敗した操作をデモに使わない。
2. Windows、VS Code、Python、`ffmpeg`（`gdigrab` と `libx264` が利用可能）が必要。`VSCODE_BIN` や `FFMPEG` を指定する場合は各実行ファイルのパスを使う。録画と変換の前に `ffmpeg -version` などで実行できることを確認する。
3. `test/fixtures/demo.md` と `test/fixtures/icon.png` のコピーを、毎回新しい `test/.run/` 内のフォルダーに用意する。VS Code も独立したユーザーデータ・拡張フォルダーで開き、他の作業ファイルを録画や編集の対象にしない。

PowerShell での準備例（`$demoDir` は実行ごとに異なる）。

```powershell
New-Item -ItemType Directory -Force test/.run | Out-Null
$demoDir = Join-Path (Resolve-Path 'test/.run') ('demo-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $demoDir | Out-Null
Copy-Item test/fixtures/demo.md (Join-Path $demoDir 'demo.md')
Copy-Item test/fixtures/icon.png (Join-Path $demoDir 'icon.png')
$codeExe = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
& $codeExe --new-window --disable-workspace-trust --skip-welcome --skip-release-notes `
  "--user-data-dir=$demoDir/user" "--extensions-dir=$demoDir/extensions" `
  "--extensionDevelopmentPath=$PWD" "$demoDir/demo.md"
```

開発版のプレビューが開けることを確認し、チャット欄や通知を閉じる。録画中はウィンドウを前面に保ち、別のアプリ、通知、個人情報が範囲に入らないことを確認する。失敗・中断した動画は採用しない。

## 実画面を動画で録画する

computer-use のスキルに従って対象の VS Code を特定し、毎回画面の位置を確認してから操作する。次の3本はそれぞれ確認済みのコピーを使う。行列操作で表を変更した場合は、必要に応じて次の撮影前に新しいコピーを用意する。

1. **セル編集・Tab**：最初の行の `りんご` を `Apple` に編集し、Tab で次のセルへ移って `12` を `14` に変更する。確定後、保存済みファイルの該当行と表以外が期待どおりか確認する。
2. **ソート・フィルタ・行列**：数量の昇順、状態「完了」の絞り込み、行と列の追加を行う。並べ替えと絞り込みだけではファイルが変わらず、行列操作後は意図した表が保存されていることを確認する。空行が絞り込みで隠れる場合は条件を解除してから見せる。
3. **表示・スクロール同期**：`mdTableTools.openIn` を `beside` にし、エディタとプレビューの両方を表示する。Mermaid、KaTeX、相対画像が見えることを確認し、プレビューから下へ、エディタから上へスクロールして他方の追従を確認する。この双方向の確認は画面で行い、E2E テストの合格だけを根拠にしない。

範囲は実画面とディスプレイ倍率に合わせて決める。例えば左上 `(459, 220)`、幅 `700`、高さ `300` の場合は次のように30fps・音声なしで録画する。座標は例であり、そのまま使わない。`-draw_mouse 1` で実際のカーソルを含める。

```powershell
& $env:FFMPEG -f gdigrab -framerate 30 -offset_x 459 -offset_y 220 `
  -video_size 700x300 -draw_mouse 1 -i desktop -t 90 -an `
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$demoDir/edit.mp4"
```

録画は操作より先に始め、完了後に正常終了を確認する。録画領域から外れたカーソル、別画面の重なり、途中で止まった操作があれば撮り直す。元動画や一時画像はGit管理外の `test/.run/` に置く。

## GIFへの変換と確認

録画を再生し、操作と結果が分かる開始・終了時刻を選ぶ。区間は `開始:終了` 秒で指定し、長い待ち時間だけを取り除く。切り出し範囲は動画に対する座標で指定し、必要な操作やカーソルを切らない。まず一時フォルダーに出力する。

```powershell
python tools/video-to-gif.py --ffmpeg $env:FFMPEG --input "$demoDir/edit.mp4" `
  --output "$demoDir/demo-edit.gif" --segments '18:22,24:27,33:36,43:46,49:52' `
  --crop '700:280:0:0' --fps 20
python tools/video-to-gif.py --ffmpeg $env:FFMPEG --input "$demoDir/operations.mp4" `
  --output "$demoDir/demo-operations.gif" --segments '20:25,30:32,38:40,46:50,52:55,84:89,96:99,102:108' `
  --crop '700:350:0:0' --fps 20
python tools/video-to-gif.py --ffmpeg $env:FFMPEG --input "$demoDir/preview.mp4" `
  --output "$demoDir/demo-preview.gif" --segments '22:31,37:43,48:54' `
  --crop '1144:690:0:0' --width 900 --fps 20
```

上の時刻と範囲は2026-10-30の録画例で、再録画時には選び直す。横並び表示は `--width 900` を目安に縮小する。滑らかさを優先し、30fpsで録画した動画から20fpsを目安にGIFを生成する。

```powershell
python tools/check-demo-gifs.py --ffmpeg $env:FFMPEG `
  "$demoDir/demo-edit.gif" "$demoDir/demo-operations.gif" "$demoDir/demo-preview.gif"
```

このチェックはGIFのデコード、複数の異なるフレーム、平均15fps以上、各5 MiB以下を確認する。操作の正しさ、カーソルの表示、秘密情報の混入、文字の読みやすさやループは判定しない。実際の再生と保存内容も確認し、必要なら切り出しやサイズを調整する。確認済みの3本だけを `images/` に反映する。

チェッカー自体の検証は `python -m unittest discover -s test/demo -v` で実行できる。CI ではチェッカーのテストとリポジトリ内の3本を確認する。

公開後は Marketplace と Open VSX の該当バージョンで3画像の読み込みと表示を確認する。公開済み版の確認と、未公開の変更の確認は分けて記録する。
