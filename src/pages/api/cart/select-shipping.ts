import type { APIRoute } from 'astro';
import { selectShippingRate } from '../../../lib/storeApi';
import { badRequest, cartSession, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ rate_id?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.rate_id)) return badRequest('Ógildur sendingarmáti.');
  const { token, timeoutMs } = await cartSession(ctx);
  return respondCart(ctx, await selectShippingRate({ rate_id: body.rate_id }, token, timeoutMs));
};
