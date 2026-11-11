import type { APIRoute } from 'astro';
import { removeItem } from '../../../lib/storeApi';
import { badRequest, cartSession, limitCartWrite, isNonEmptyString, readJson, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ key?: unknown }>(ctx);
  if (!body || !isNonEmptyString(body.key)) return badRequest('Ógild beiðni.');
  const limited = limitCartWrite(ctx);
  if (limited) return limited;
  const { token, timeoutMs } = await cartSession(ctx);
  return respondCart(ctx, await removeItem({ key: body.key }, token, timeoutMs));
};
