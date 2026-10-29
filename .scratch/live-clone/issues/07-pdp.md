# 07 Product page

Type: task
Status: resolved
Blocked by: 04

## Question

Gallery, summary, swatches, the "Lýsing" / "Frekari upplýsingar" sections, and the related grid, matching
live.

## Answer

The product page reproduces live's Goya `et-product-layout-regular`. It was measured on live (visitor GETs
only; one swatch click, never added to cart) at 1440 and 390, using the Nike Mercurial Superfly 10 Elite FG
and HOKA Restore TC products, which exist in both datasets.

**Layout:**
- Gallery: a 7/12 column, 801px at 1440. The first image is full width, the rest are two-up with 20px gaps,
  and each image opens a `<dialog>` lightbox (arrows, keys, count).
- Below 992px the gallery is a scroll-snap slider with 8px dots over the image (`PdpGallery`).
- The summary sits in a sticky 5/12 column with 45px left padding.

**Summary, in live's order:**
- Breadcrumbs as WooCommerce builds them: the main term is the product category with the highest parent id
  (`productCrumbTrail`, tested). Example: "Heim / Verslun / Kyn / Karlar", with no product name.
- Title at 35.2/42.24.
- `price_html` with a red-outline "30 % Off" pill. Live hides the "-" on the PDP.
- "—— Stærðartafla" opens a popup that lazily lifts `/staerdir/`; the link is the no-JS fallback
  (`SizeGuide`).
- Squared swatches (16px, 12px padding):
  - Options sold out under the current selection are crossed out and disabled (`optionState`, tested).
  - "Stærðir : 40" once chosen, a dark tooltip, a "⊗ Hreinsa" reset and a green "Á lager" pill.
  - A variation price shows only when variation prices differ (`pricesVary`, tested).
  - The first image and the SKU follow the chosen variation.
- Quantity box (104×58) beside "Setja í körfu" (`#181818`, 70% opacity while disabled). On mobile they
  stack.
- Accordion rows (19.8px, thin +):
  - "Lýsing" holds the short description, as live does. Live's own panel is empty for most products, so with
    no short description the row jumps to the description section.
  - "Frekari upplýsingar" holds WooCommerce's attribute table.
- Meta: Vörunúmer / Flokkur(Flokkar) / Merkimiði(ar) / Brand, with terms alphabetical and linked.
- Share with a Facebook link.

**Below the summary:**
- The full description in live's boxed 820px column.
- "Tengdar vörur": 5 related products, 5-up with full titles. On mobile it is 1-up with dots.
  `ProductRow` has a `related` variant, and `ProductCard` has a `fullTitle` prop.

**Removed (live has none):** the wishlist button, the trust list, the brand eyebrow, the old thumbnail strip
and `WaitlistForm` with `/api/waitlist`. Dead card-gallery and thumbnail handlers were taken out of
`Base.astro`.

**Verified:**
- At 1440, local equals live within 0–3px: gallery 801×1001 at 15/173, second image 391 at y1194; summary
  x846; breadcrumbs 203, title 245, price 345, size guide 398, swatches 440/502, cart 587 (live 588), tabs
  665, meta 791, share 883.
- The selected state (HOKA size 40) matches live's: stock pill at 575, SKU swapped to `1134532/BBLC-40`.
- At 390, local equals live within 2px through Share: summary 456, title 528, price 629, quantity 908, ATC
  976.
- Lightbox opens and steps (3 / 8), the size-guide popup loads the tables, and add to cart returns 201 and
  opens the side cart.
- A simple out-of-stock product renders with the "Uppselt" pill.
- `astro check` 0/0/0, vitest 71/71, build green, routes 23/23.
- Shots: `.playwright-mcp/shots/{live,local}-pdp-*.png`.
