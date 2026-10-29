#!/bin/zsh
# Run hscroll.mjs over the area-00 pages at every width that matters for the shell breakpoints.
base=${1:-http://127.0.0.1:4323}
widths=1920,1440,1400,1399,1280,1200,1199,1100,1024,992,991,768,390,360,320
for p in / /voruflokkur/skor/ /hafa-samband/ /karfa/ /gera-upp/ /oskalisti/ /min-sida/ /skilmalar/; do
  node "${0:A:h}/hscroll.mjs" "$base" "$p" "$widths"
done
