# WordPress mu-plugins (backend dependency of this storefront)

These files are **not loaded from here** — they are the version-tracked source of
WordPress must-use plugins this headless storefront depends on. The live copy must
live at `app/public/wp-content/mu-plugins/` (outside this repo).

- **mos-posturinn-droppoints.php** — public read-only REST endpoint
  `GET /wp-json/mos/v1/droppoints?postcode=&type=postbox|parcelpoint` that lists
  Pósturinn parcel lockers / post offices for a postcode (via the plugin's
  `POSTIS_API`). The storefront's `/api/posturinn/droppoints` proxy + the cart/checkout
  parcel-locker selector require it. If WP runs without it, the locker list is empty.

Deploy: copy `mos-posturinn-droppoints.php` to `wp-content/mu-plugins/` on the WP host.
