# 03 Save hook

Type: task
Status: done
Blocked by: 02
See map.md.

`woocommerce_new_product` / `woocommerce_update_product` queue the id; a shutdown flush fills empty fields with the 02
rules (re-entrancy guard `mos_clean_running`, also set during CLI runs).

Verified 2026-10-29 with two throwaway drafts (deleted): "Speedo sundbolur dömu svartur" → speedo, Konur, Sund,
Svartur, lookup rows written; a draft with Rauður set by hand and "svartur" in the name kept Rauður.
