#!/bin/zsh
# Area 02: hscroll.mjs over the wall pages (and home, wishlist) at 320–1920, rail open; the hidden-rail state is
# covered by area02-probe.mjs (hscroll per width with the rail folded).
base=${1:-http://127.0.0.1:4323}
widths=1920,1600,1440,1400,1399,1280,1200,1199,1100,1024,992,991,768,600,390,360,320
for p in / /voruflokkur/skor/ '/voruflokkur/skor/?kyn=konur' /verslun/ /voruflokkur/sale/ /brand/nike/ /merkimidar/born/ '/?s=hoka&post_type=product' /oskalisti/; do
  node "${0:A:h}/hscroll.mjs" "$base" "$p" "$widths"
done
