#!/usr/bin/env python3
"""ページで使う文字だけを入れた軽いフォントを assets/fonts/ に作る。

index.html の文章を変えて、新しい漢字を使ったら実行し直す。
（実行し直さなくても表示は崩れない。足りない字だけ端末のフォントで出る）

準備:
    pip install fonttools brotli
    npm install @fontsource/dela-gothic-one @fontsource/mochiy-pop-one \
        @fontsource/zen-kaku-gothic-new @fontsource/zen-maru-gothic \
        @fontsource/chakra-petch @fontsource-variable/archivo
実行:
    python tools/subset-fonts.py <node_modules のパス>

フォントはすべて SIL Open Font License 1.1。
"""
import html
import re
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts"
NODE_MODULES = Path(sys.argv[1] if len(sys.argv) > 1 else "node_modules")

# 日本語フォント: (npm パッケージ, 元ファイル, 出力ファイル)
JAPANESE = [
    ("@fontsource/dela-gothic-one", "dela-gothic-one-japanese-400-normal.woff2", "dela-gothic-one.woff2"),
    ("@fontsource/mochiy-pop-one", "mochiy-pop-one-japanese-400-normal.woff2", "mochiy-pop-one.woff2"),
    ("@fontsource/zen-kaku-gothic-new", "zen-kaku-gothic-new-japanese-500-normal.woff2", "zen-kaku-gothic-new-500.woff2"),
    ("@fontsource/zen-kaku-gothic-new", "zen-kaku-gothic-new-japanese-900-normal.woff2", "zen-kaku-gothic-new-900.woff2"),
    ("@fontsource/zen-maru-gothic", "zen-maru-gothic-japanese-500-normal.woff2", "zen-maru-gothic-500.woff2"),
    ("@fontsource/zen-maru-gothic", "zen-maru-gothic-japanese-900-normal.woff2", "zen-maru-gothic-900.woff2"),
]
# 欧文フォントは小さいのでそのまま置く
LATIN = [
    ("@fontsource-variable/archivo", "archivo-latin-wdth-normal.woff2", "archivo.woff2"),
    ("@fontsource/chakra-petch", "chakra-petch-latin-400-normal.woff2", "chakra-petch-400.woff2"),
    ("@fontsource/chakra-petch", "chakra-petch-latin-600-normal.woff2", "chakra-petch-600.woff2"),
    ("@fontsource/chakra-petch", "chakra-petch-latin-700-italic.woff2", "chakra-petch-700-italic.woff2"),
]


def page_characters() -> str:
    """index.html の本文と、かな・記号ひととおり。"""
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    source = re.sub(r"<(script|style)\b.*?</\1>", "", source, flags=re.S)
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", " ", source))
    # alt などの属性にしかない文字は絵として出ないので含めない
    chars = set(text)
    chars |= {chr(c) for c in range(0x20, 0x7F)}        # ASCII
    chars |= {chr(c) for c in range(0x3000, 0x3100)}    # 句読点、ひらがな、カタカナ
    chars |= {chr(c) for c in range(0xFF01, 0xFF5F)}    # 全角英数・記号
    chars |= set("‘’“”…―—–·•×÷±°©→←↑↓↗↘〜～・「」『』（）［］【】／％＋－＝")
    return "".join(sorted(c for c in chars if c.isprintable()))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    text = page_characters()
    total = 0
    for package, src, dst in JAPANESE:
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["*"]      # 縦書き用の字形（vert）なども残す
        options.notdef_outline = True
        options.name_IDs = [1, 2, 3, 4, 6]
        font = TTFont(NODE_MODULES / package / "files" / src)
        subsetter = subset.Subsetter(options)
        subsetter.populate(text=text)
        subsetter.subset(font)
        font.flavor = "woff2"
        font.save(OUT / dst)
        size = (OUT / dst).stat().st_size
        total += size
        print(f"{dst:34s} {size / 1024:6.1f} KB")
    for package, src, dst in LATIN:
        shutil.copyfile(NODE_MODULES / package / "files" / src, OUT / dst)
        size = (OUT / dst).stat().st_size
        total += size
        print(f"{dst:34s} {size / 1024:6.1f} KB")
    print(f"{len(text)} 文字、合計 {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
