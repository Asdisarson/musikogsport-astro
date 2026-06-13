import type { APIRoute } from 'astro';
import { checkout } from '../../lib/storeApi';
import { badRequest, ensureToken, isNonEmptyString, readJson, respondCart, writeOrderCookie } from '../../lib/cartProxy';
import type { CheckoutPayload } from '../../lib/types';

export const prerender = false;

// Places the order via the Store API. On success the server-side cart is emptied
// and a fresh Cart-Token is returned; respondCart rotates the cookie accordingly.
// We also stash {order_id, order_key} in a short-lived httpOnly cookie so the
// thank-you page can recover the order after a redirect-gateway round-trip even if
// the return URL's query params are stripped.
export const POST: APIRoute = async (ctx) => {
  const body = await readJson<CheckoutPayload>(ctx);
  const billing = body?.billing_address;
  // Trust boundary: we guard only the two fields whose absence we can localize sensibly
  // (email + payment_method). The WooCommerce Store API is the authoritative validator for the
  // rest of the payload (addresses, payment_data, line items) and rejects bad input itself —
  // re-validating every field here would risk diverging from Woo's rules and rejecting valid orders.
  if (
    !body ||
    !billing ||
    typeof billing !== 'object' ||
    !isNonEmptyString(billing.email) ||
    !isNonEmptyString(body.payment_method)
  ) {
    return badRequest('Ógild pöntun. Vantar greiðslu- eða afhendingarupplýsingar.');
  }
  const token = await ensureToken(ctx);
  const result = await checkout(body, token);
  if (result.ok && result.data?.order_id && result.data?.order_key) {
    writeOrderCookie(ctx, { order_id: result.data.order_id, order_key: result.data.order_key });
  }
  return respondCart(ctx, result);
};
