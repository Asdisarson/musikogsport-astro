# 10 Integration sweep + /ship

Type: task
Status: resolved — /ship READY WITH NOTES (2026-10-14); `/verify` is user-invoked, still to run
Blocked by: 05, 06, 07, 08, 09

## Question

Link crawl, redirects and gates; then the consolidated /ship, the commit series and the memory update.

## Answer

### Sweep (8ee0a90)

- `scripts/crawl_links.py`: all 184 homepage links plus a 60-URL sitemap sample, and JSON-LD parses on the
  home, archive and product pages.
- Empty-but-existing categories render like WooCommerce (200, no products).

### /ship

- **/code-review:** five review runs, fixed in `8039ae7` … `8e6bf61`:
  - money, auth and security, functional, resilience and spec gaps
  - JWT revocation bound to the password hash
  - per-visitor limits with trusted proxy hops
  - guest checkout and then the account link
  - the order key stripped from Straumur returns
  - 503s on outages, and the serialised cart
- **/polish:** `681b735`, no behaviour change.
- **/x-ray:** five lenses; 0 Critical, 22 Warning, 8 Info.
- **/cleanup:** one commit per category:
  - `ad07357` security: store-wide contact cap; the dead bridge postis routes and meili webhook removed;
    `sameOrigin` on checkout; the DEPLOY.md firewall list
  - `59041b8` input: account input caps; contact body handling
  - `3209069` correctness: droppoints reports a Pósturinn outage (502, memoized a minute); cart buttons
    catch their errors
  - `7db7acb` api: 503 on the legacy `/vara/`, the orders list and a cold-start home page
  - `7916b8e` observability: logging added
  - `5c4561c` architecture: dead woo.ts helpers removed
- **/security-review:** no finding reached confidence 8.
  - One candidate was filtered as a rate-limit issue but fixed anyway in `2ed06a1`.
  - edit-account's failure fallback signed in with the form's email, so a signed-in customer could test
    any account's password, and a right guess got that session.
  - It now recovers only after a timeout, and only with this customer's own token.
  - Probe: 2 FAIL → 7/7 PASS.
- **Gates at `2ed06a1`:**
  - `astro check`: 0 errors / 0 warnings / 1 hint (ts(80006) "may be converted to an async function" in
    `src/lib/auth.ts`, from ticket 09; cosmetic, left as is)
  - vitest: 148/148
  - `npm run build`: green
  - `verify_live_routes`: 31/31
  - crawl: OK
  - signed-in bacs smoke: all PASS
  - test data removed; HOKA stock 5 / total_sales 3
- **`/verify`:** not run, because it can only be invoked by the user. `.claude/skills/verify/SKILL.md` now
  describes this branch (handle :4322, or :10026 after the handoff).

### Review coverage

- `5aadf32`, `8e6bf61` and the cleanup range `ad07357`…`2ed06a1` were runtime-checked but never code-reviewed.
- The timeout-recovery branch of `2ed06a1` was typechecked only.

### Known limitations

1. **Straumur `payfacReference` overwrite.** The third-party plugin's return handler saves a session's
   reference without binding the session to the order. This was already true on live. The fix needs
   Straumur's merchant reference.
2. **Unverified-payment branch:** copy only.
3. **Concurrent rehash:** an alias race.
4. **Neutral thank-you:** receipts on another host, for invoice payers, or in another browser show it.
5. **Checkout validation:** can be stale under the cart lock (mitigated).
6. **Order link:** runs in the server process.
7. **details.ts:** retries immediately.
8. **Password policy:** literals.
9. **Account pages during an outage:** view-order, edit-address and edit-account still answer 404 or an
   empty 200. A helper change is needed across 5 call sites.
10. **No limiter on saves:** the address and account-details saves (signed-in, own record).
11. **Full query passthrough:** the `straumurStatus` redirect forwards the whole query, same-host
    (`[?]`, possibly intentional).
12. **Edit-account email:** an email in use gives "not saved" while a free one saves. This is
    WooCommerce's own behaviour.
13. **Store-wide contact cap (30 per clock hour):** one spammer can use up the hour for genuine senders.
    This is the deliberate trade-off against unbounded admin mail.

### Refactor proposals (not done)

- Account outage signal from `getCustomer`/`getOwnOrder`.
- One date formatter and order-totals component.
- A single brand/tag archive route.
- WP calls through `askWordPress`.
- `runSweep` → `createCachedLoader`.

### Deploy prerequisites (DEPLOY.md)

- `X-Forwarded-Proto` set, and `X-Forwarded-For` appended, never passed through.
- `MOS_TRUSTED_PROXY_HOPS` = 1, with Node's `HOST` on loopback.
- One canonical host.
- Guest checkout on.
- Firewall the jwt-auth, contact and lost/reset-password routes.
- WP-Cron running.
- The order-pay theme and `WP_HOME`.
- `MOS_STOREFRONT_URL` (and `MOS_HEADLESS_REDIRECT_STATUS` 301) in `wp-config.php`.
- Flush the object cache after a DB reset (in `wp-mu-plugins/README.md`).

### History

The commit hashes in this ticket postdate the 2026-10-14 trailer strip. That rewrite touched only commit
messages; every tree is unchanged. The pre-strip commits are kept on `backup/live-clone-2026-10-14` and
`backup/storefront-makeover-2026-10-14`.

### Recommendations

- Rotate the live Mailchimp API key. It is in the local dump (`GhiaGNR_options` → `mailchimp-woocommerce`).
- Earlier in the build session the local `GRAPHQL_JWT_AUTH_SECRET_KEY` from `wp-config.php` was printed into
  a transcript. Rotate it if this config ever leaves the machine.
