# 09 Account area /min-sida/

Type: task
Status: resolved
Blocked by: 04

## Question

A working account area like live's `/min-sida/`: sign-in (no register form), dashboard, orders, view-order
with an IDOR check, edit-address, edit-account, lost and reset password, and logout. A signed-in checkout
puts the order on the customer's account. Per-visitor rate limits live in Astro.

## Answer

### Live reference

Measured with visitor GETs, plus one click to open the header popup. Nothing was submitted.
- Signed out, `/min-sida/` shows a centred, bordered 460px box (no visible title, no register form):
  - "Innskráning"
  - floating "Notendanafn eða netfang *" and "Lykilorð *" with a show-password eye
  - "Muna eftir mér" | "Týnt lykilorð?"
  - an "Innskráning" button
- The header "Innskráning" opens the same form in a 480px popup.
- On mobile the box is borderless and the two links stack.
- Live's signed-in pages could not be seen (we never sign in to production). They are WooCommerce's
  standard account templates in the site's style.

### Auth

`lib/auth`:
- `POST /api/account/login` exchanges the credentials for a JWT from `jwt-auth/v1/token` (the installed plugin).
- The token lives only in the httpOnly `mos_auth` cookie: SameSite=Lax, Secure in production, a session
  cookie unless "Muna eftir mér" is ticked, in which case 7 days (the token's lifetime).
- `mos_li=1` is a non-secret flag. Cached pages use it to switch the header to "Mín síða", and the popup
  opens only when signed out.
- Identity always comes from `wp/v2/users/me` with the token (a 30-second memo); a dead token clears the
  cookie.
- Failures are generic (no account enumeration).

### Data

`lib/account`:
- WC REST with the server keys, always for the session's customer id.
- `getOwnOrder` returns null for anyone else's order, so it gets the same 404 as a missing one.
- New `wooSend` for writes.

### Pages

All no-store and noindex:
- `/min-sida/`: the login box, or the dashboard ("Halló …", WooCommerce's text).
- `/orders/[n]`: table with Icelandic status names, "Skoða", paging.
- `/view-order/<id>`: order details, note, addresses.
- `/edit-address/`: two cards with Breyta / Bæta við.
- `/edit-address/<billing|shipping>`: the checkout's fields.
- `/edit-account`: name, email, and a password change that needs the current password.
- `/lost-password`: the request form, the sent notice, and the new-password form for WooCommerce's email
  link `?key=&id=`.
- `/customer-logout`: WooCommerce's confirm. Signing out is a POST from the account nav.

Forms post normally and the API answers with a 303 redirect carrying a status flag, so everything works
without JavaScript. Floating labels are CSS only (`placeholder=" "`). The field styles are shared with the
checkout.

### Safety

- Per-visitor limits in Astro: login 10/15 min, lost password 5/h, reset 10/h. The new `createLimiter` is
  tested and now also serves `/api/contact`.
- `sameOrigin` rejects a cross-site POST with 403.
- `safeNext` blocks open redirects. Both are tested.
- The WP-side limit in `mos-account-api.php` used to key every request to the storefront server's IP, so 5
  resets per 15 minutes for the whole store. It is now a store-wide safety net of 60.

### Signed-in checkout

- `/api/checkout` forwards the live session as `Authorization: Bearer`. The Store API sets the order's
  customer from the current user (`OrderController::update_order_from_cart`, verified in WC 10.7).
- Expired tokens are not forwarded.
- `/gera-upp/` prefills billing from the customer's saved address.

### Verified

All local, with a disposable test customer (id 1209) created and then deleted through WC REST.

Sign-in and editing:
- A wrong password shows the generic error. A good one lands on the dashboard. The cookie flags are right,
  and the header reads "Mín síða".
- Orders: empty, then the test order after a signed-in checkout.
- The shipping address saves. Required-field and email checks work.
- A wrong current password is refused. A name change saves.

Security:
- Another customer's real order (262634) returns **404**.
- A cross-origin POST gets 403.
- After 10 attempts the login answers `?login=limited`.

Checkout and reset:
- Signed-in checkout: billing prefilled, and order 265096 got `_customer_user=1209`. The order was cancelled
  and deleted, with stock restored.
- Reset password with a generated key: the new password works, the key can't be replayed, and signing in
  through the header popup works.
- A lost-password request gives the generic notice. Emails are swallowed locally by disable-emails.

Layout:
- 1440 matches live within 1–3px: box at y173, title 215, fields 311/393, button 523. The popup is
  480×484 at y208.
- 390 matches live: fields 41,247 / 329, button 502.

Gates:
- vitest 97/97, `astro check` 0/0/0, build green, routes 31/31 (3 new account checks).
