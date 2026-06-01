import type { APIRoute } from 'astro';
import { updateCustomer } from '../../../lib/storeApi';
import { badRequest, ensureToken, readJson, respondCart } from '../../../lib/cartProxy';
import type { Address } from '../../../lib/types';

export const prerender = false;

// Sets billing/shipping address on the cart so shipping rates get calculated.
export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ billing_address?: Partial<Address>; shipping_address?: Partial<Address> }>(ctx);
  if (!body || (typeof body.billing_address !== 'object' && typeof body.shipping_address !== 'object')) {
    return badRequest('Ógild beiðni.');
  }
  const token = await ensureToken(ctx);
  return respondCart(
    ctx,
    await updateCustomer({ billing_address: body.billing_address, shipping_address: body.shipping_address }, token),
  );
};
