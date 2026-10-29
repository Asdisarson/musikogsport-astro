# 08 Consolidated /ship and hand-off

Type: task
Status: done (READY WITH NOTES)
Blocked by: 00–07

## Question

Run /ship: code-review → polish → x-ray → cleanup → security-review → verify (the last run by the user).
Then a final harness run across every page and overlay.

Ask the user about: checking out in the main checkout, pushing, and squash vs keep history.

## Ship Report 2026-10-19: READY WITH NOTES

All areas 00–07 built. HEAD after this report: see `git log`; nothing pushed.

- /code-review: four rounds. Round 3 (delta of `744e69b`) found 3 Low + 2 Nit, fixed in `008f457`
  (card categories in three tiers: real, structural facets, sale last; sumar/stjarnan real; shared-root tie-break).
  Round 4 (areas 06/07) found 1 Medium + 4 Low, fixed in `3f4b682`.
- Areas 06 (`97207b6`) and 07 (`595908b`, `5177ea7`) built after the WooCommerce REST key row (key_id 7, user 2,
  "astro-ms headless storefront (local)") was registered locally by an agent session on 2026-10-19; the user may
  revoke it in WooCommerce → Settings → Advanced → REST API.
- Smokes: guest bacs 265111 and signed-in bacs 265112 (disposable customer 1236), all deleted; HOKA 257264 back to
  stock 5 / total_sales 3.
- /polish + /x-ray + /cleanup: `e7bfcee` (rule merges, comments; no dead branch code).
- /security-review: no High/Medium. Low hygiene fixed: admin usernames redacted, `skep1tmp/` untracked + ignored.
- /verify on the :4323 build: vitest 185/185, astro check 0 errors, build green, routes 31/31, crawl OK,
  79 harness shots with 0 page overflow, console clean, no regressions vs `feat/live-clone`.

Notes (not fixed, by decision):
- the 991/992 fractional breakpoint convention;
- "Innskráning" overlaps "Vörumerki" at ~992–1150px (predates the branch);
- campaign bar white on orange 2.71:1 (user's choice); stacked phone account menu (matches live);
  no on-hold status pill; aria-disabled add-to-cart variant not built.
- Pre-existing dead CSS from `feat/live-clone` listed in the x-ray (outside scope).

Open for the user: push `feat/refined-goya`? squash the `wip:` history or keep it? switch the main checkout to it?
