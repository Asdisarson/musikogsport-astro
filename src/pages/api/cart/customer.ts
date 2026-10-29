import type { APIRoute } from 'astro';
import { updateCustomer } from '../../../lib/storeApi';
import { badRequest, ensureToken, readJson, respondCart } from '../../../lib/cartProxy';
import { isPlainObject } from '../../../lib/validate';
import type { Address } from '../../../lib/types';

export const prerender = false;

// Sets billing/shipping address on the cart so shipping rates get calculated.
export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ billing_address?: Partial<Address>; shipping_address?: Partial<Address> }>(ctx);
  const billing = isPlainObject(body?.billing_address) ? body!.billing_address : undefined;
  const shipping = isPlainObject(body?.shipping_address) ? body!.shipping_address : undefined;
  if (!billing && !shipping) {
    return badRequest('Ógild beiðni.');
  }
  const token = await ensureToken(ctx);
  return respondCart(ctx, await updateCustomer({ billing_address: billing, shipping_address: shipping }, token));
};
