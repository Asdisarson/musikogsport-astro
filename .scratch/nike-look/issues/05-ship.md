# 05 Consolidated /ship

Type: task
Status: done (READY)
Blocked by: 00–04

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Review fixes (2026-10-23, on 6ab45d2, uncommitted)

The code review's N-1 to N-14, fixed in the working tree:

- N-1: the lightbox reads the image's full-size `src`, not `currentSrc`. Image 2 at 1440 now opens at a natural width
  of 1110 (HOKA) and 1638 (Nike Gamma Force).
- N-2: `lib/cartCity.ts`. The Store API returns the town as `&#8211;`. The cart now shows "Sending til 220." and the
  town field opens empty. The request still sends `-`.
- N-3: `lib/storeMap.ts` (the Store API mapper, moved out of `storeCatalog.ts` so it can be tested) keeps `srcset`,
  `sizes` and `thumbnail`. `productImage()` returns `srcset`, and `ProductCard` passes it with a `sizes` per
  variant. The wishlist gets `srcset` through `ProductSummary`, and its `onError` drops the srcset before falling back
  to the placeholder.
  - Measured candidates at DPR 1: wall 360–720w at 1440 and 390; tiles 450–576w at 1440 and 360–576w at 390;
    wishlist 360–720w.
- N-4: `[data-suppress] > .mega` hides the panel at once. Escape followed by Tab now lands on "Börn", outside the
  panel, and hovering reopens it.
- N-5: `lib/gridNav.ts` `gridStep` moves by index over every option and skips sold-out ones.
  - None of the first six HOKA sizes is sold out, so 38⅔ was disabled in the probe.
  - With 38⅔ disabled: Down from 36 goes to 41⅓, Down from 37⅓ goes to 40, Right from 37⅓ goes to 40.
- N-6: the hero CTA skips `#` and blank hrefs. A banner headline falls back from the heading to the banner title, the
  first slide name, then "Nýjungar". A blank slide name falls back to "Nýjungar".
- N-7: `.pdp-thumbs` subtracts the 45px store notice. At 1440×800 the scrolled thumb column ends at 731, above the
  notice at 755.
- N-8: the chip row and tile tracks get `padding-block: 4px; margin-block: -4px`. The 4px ring is whole, snap is
  unchanged, and the gap from the head to the tile is still 12px.
- N-9: the phone account icon uses `data-login-label` and reads "Mín síða" when signed in.
- N-10: "Vörumerki" (href `/`) is now a `<span>` heading. No mega heading links to `/` or `#`.
- N-11 removed:
  - the campaign-dismiss branch (the store notice dismiss still persists `{"notice":…}`);
  - `.badge--sale`, `--sale-strong` and the `.badge` colour;
  - the related `ProductRow` variant with its arrows, dots and CSS;
  - the footer's duplicate Persónuvernd link.
- N-12: the products API runs `Promise.all` and still returns 502 when the products call fails.
- N-13: the thumbnails use the 450 crop with no srcset.
- N-14: Jost, Anton and Oswald are dropped (package.json and the lock only). `node_modules` is still a symlink.

Gates: vitest 253/253; astro check 0 errors, 0 warnings, 1 old hint in auth.ts; build OK; routes 31 PASS; crawl OK;
hscroll 0 at 320–1920 on home, archive, PDP and cart; no console errors.
Probes: `harness/review-{fixes-probe,cart-town,css-probe,wishlist}.mjs` and `review-hscroll.sh`.


## Ship Report 2026-10-23: READY

- Areas: 00 shell 7a2d836, 01 home 379f585, 02 wall 77f2500, 03 PDP 770b455, 04 bag/checkout/account 6ab45d2.
- /code-review (one reviewer): 0 Critical/High; 2 Medium + 1 Medium perf + Lows/Nits, all fixed in cf7c353 (19 tests).
- /polish + /x-ray + /cleanup: 5386b98 (measured sizes 320-2560, dead tokens/rules removed, layout diff unchanged on 11 pages).
- /security-review: no findings. /verify on the :4323 build: vitest 253/253, astro check 0 errors, build green, routes 31/31, crawl OK, 161 shots, sizes-measure exit 0, overflow 0 at 12 widths on 9 pages, console clean.
- Smokes: bacs 265113 (guest) and 265114 (signed-in, customer 1237) deleted; stock 5 / total_sales 3.

Notes: "Nýtt" labels need a publish date from the mu-plugin; no hover colour swatches (no per-colour images); PDP shows the gallery before the title on phones; some source photos carry their own grey; public/logo-footer.webp now unused (kept).
Open for the user: push feat/nike-look? switch the main checkout / :10026 to it? squash at PR merge.
