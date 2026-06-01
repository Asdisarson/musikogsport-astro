import type { APIRoute } from 'astro';
import { removeItem } from '../../../lib/storeApi';
import { badRequest, ensureToken, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ key?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.key)) return badRequest('Ógild beiðni.');
  const token = await ensureToken(ctx);
  return respondCart(ctx, await removeItem({ key: body.key }, token));
};
