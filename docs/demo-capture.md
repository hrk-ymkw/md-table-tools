# デモ画像の再生成

3本のGIFは、開発用 VS Code で `test/fixtures/demo.md` のコピーを操作し、画面を15fps・音声なしで録画した動画から生成した。長い待ち時間をカットし、必要な範囲を切り出している。サンプルの画像は `test/fixtures/icon.png` を同じフォルダーにコピーする。

## 録画

Windows の `ffmpeg` が必要。録画対象の VS Code を前面に表示し、プレビューまたはエディタとプレビューの領域を指定して `gdigrab` で録画する。位置と大きさは使用する画面に合わせる。録画領域に別のウィンドウや通知が重ならないようにする。

例えば、プレビュー領域が画面上の `(984, 215)` にあり、幅576・高さ500の場合は次のように録画する。

```powershell
ffmpeg -f gdigrab -framerate 15 -offset_x 984 -offset_y 215 -video_size 576x500 -draw_mouse 1 -i desktop -t 45 -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p test/.run/edit-video.mp4
```

同期デモはエディタとプレビューの両方が入る範囲を録画する。操作時間や画面の位置は環境によって変わるため、録画後に映像を確認し、下記の切り出し範囲と時間を調整する。

## GIFへの変換

Python と `ffmpeg` を使い、動画内の必要な時間帯をつなぎ、色数を128色に抑えて変換する。以下は今回の録画から生成したときの設定例。`$ffmpeg` は使用する `ffmpeg.exe` のパスに置き換える。

```powershell
python tools/video-to-gif.py --ffmpeg $ffmpeg --input test/.run/edit-video.mp4 --output images/demo-edit.gif --segments '11.2:14.5,19:21.8,28:30.5,35:37.5,41.8:45' --crop '576:300:0:0' --fps 15
python tools/video-to-gif.py --ffmpeg $ffmpeg --input test/.run/operations-video.mp4 --output images/demo-operations.gif --segments '10.5:13.2,17.8:19.8,24:26.7,31.6:34.2,38:41.2,44.5:47.2,51:55' --crop '576:400:0:0' --fps 15
python tools/video-to-gif.py --ffmpeg $ffmpeg --input test/.run/sync-video.mp4 --output images/demo-preview.gif --segments '10.8:14.5,19.3:23,28.8:32.5,35:40' --crop '1144:690:0:0' --width 900 --fps 15
```

録画元動画と一時ファイルは `test/.run/` に置き、リポジトリには含めない。生成後は全シーンとループの切り替わりを確認する。画面操作から録画・時間指定までの自動再生は未実装。
