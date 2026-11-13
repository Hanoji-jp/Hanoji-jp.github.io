# Hanoji-jp.github.io

Hanoji のポートフォリオサイトです。公開先: https://hanoji-jp.github.io/

## ファイル

| ファイル | 中身 |
|---|---|
| `index.html` | 文章と構成 |
| `style.css` | 見た目。作品ごとの色は `.scene--*` の `--w-*` |
| `script.js` | スクロールに合わせた色の切り替えと、TankAce の三角形の背景 |
| `assets/` | 画像、動画、フォント |
| `tools/subset-fonts.py` | フォントの作り直し |

## よくある変更

- **DRIFT PROJECT の動画を入れる:** `index.html` の `<figure class="d-video">` の中身を、コメントに書いてある `<iframe>` に置き換える。
- **メールアドレスを変える:** `index.html` の「連絡先」にある2か所（表示している文字と、ボタンの `mailto:`）を書き換える。
- **文章を変える:** 新しい漢字を使ったら `tools/subset-fonts.py` を実行し直す。実行しなくても表示は崩れず、足りない字だけ端末のフォントで出る。

## フォント

Dela Gothic One、Mochiy Pop One、Zen Kaku Gothic New、Zen Maru Gothic、Archivo、Chakra Petch（いずれも SIL Open Font License 1.1）。
