import type { APIRoute } from 'astro';
import { removeCoupon } from '../../../lib/storeApi';
import { badRequest, cartSession, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ code?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.code)) return badRequest('Ógildur afsláttarkóði.');
  const { token, timeoutMs } = await cartSession(ctx);
  return respondCart(ctx, await removeCoupon({ code: body.code }, token, timeoutMs));
};
