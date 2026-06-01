import type { APIRoute } from 'astro';
import { addItem, getCart } from '../../../lib/storeApi';
import { badRequest, clampQty, ensureToken, isPosInt, readJson, readToken, respondCart } from '../../../lib/cartProxy';

export const prerender = false;

export const GET: APIRoute = async (ctx) => respondCart(ctx, await getCart(readToken(ctx)));

export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ id?: unknown; quantity?: unknown; variation?: unknown }>(ctx);
  if (!body || !isPosInt(body.id)) return badRequest('Ógild vara.');
  const variation = Array.isArray(body.variation)
    ? body.variation.filter(
        (v): v is { attribute: string; value: string } =>
          !!v &&
          typeof (v as { attribute?: unknown }).attribute === 'string' &&
          typeof (v as { value?: unknown }).value === 'string',
      )
    : undefined;
  const token = await ensureToken(ctx);
  return respondCart(ctx, await addItem({ id: body.id, quantity: clampQty(body.quantity), variation }, token));
};
