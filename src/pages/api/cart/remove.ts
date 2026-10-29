import type { APIRoute } from 'astro';
import { removeItem } from '../../../lib/storeApi';
import { badRequest, ensureToken, limitCartWrite, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ key?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.key)) return badRequest('Ógild beiðni.');
  const limited = limitCartWrite(ctx);
  if (limited) return limited;
  const token = await ensureToken(ctx);
  return respondCart(ctx, await removeItem({ key: body.key }, token));
};
