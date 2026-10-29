#!/bin/zsh
# Review fixes: horizontal page overflow 320–1920 on home, archive, PDP and cart.
base=${1:-http://127.0.0.1:4323}
widths=1920,1440,1400,1200,1199,1024,992,991,768,390,360,320
for p in / /voruflokkur/skor/ /verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/ /karfa/; do
  node "${0:A:h}/hscroll.mjs" "$base" "$p" "$widths"
done
