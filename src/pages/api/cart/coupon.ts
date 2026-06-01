import type { APIRoute } from 'astro';
import { applyCoupon } from '../../../lib/storeApi';
import { badRequest, ensureToken, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ code?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.code)) return badRequest('Ógildur afsláttarkóði.');
  const token = await ensureToken(ctx);
  return respondCart(ctx, await applyCoupon({ code: body.code }, token));
};
