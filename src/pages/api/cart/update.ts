import type { APIRoute } from 'astro';
import { updateItem } from '../../../lib/storeApi';
import { badRequest, clampQty, ensureToken, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ key?: unknown; quantity?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.key)) return badRequest('Ógild beiðni.');
  const token = await ensureToken(ctx);
  return respondCart(ctx, await updateItem({ key: body.key, quantity: clampQty(body.quantity) }, token));
};
