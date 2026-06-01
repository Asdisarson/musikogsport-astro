import type { APIRoute } from 'astro';
import { checkout } from '../../lib/storeApi';
import { badRequest, ensureToken, isNonEmptyString, readJson, respondCart } from '../../lib/cartProxy';
import type { CheckoutPayload } from '../../lib/types';

export const prerender = false;

// Places the order via the Store API. On success the server-side cart is emptied
// and a fresh Cart-Token is returned; respondCart rotates the cookie accordingly.
export const POST: APIRoute = async (ctx) => {
  const body = await readJson<CheckoutPayload>(ctx);
  const billing = body?.billing_address;
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
  return respondCart(ctx, await checkout(body, token));
};
