import type { APIRoute } from 'astro';
import { getProductsByIds, getVariationStock, LIVE_PRODUCT_FIELDS } from '../../../../lib/woo';
import { jsonResponse, tooManyRequests } from '../../../../lib/http';
import { createLimiter } from '../../../../lib/rateLimit';
import { visitorKey } from '../../../../lib/visitor';
import { coalesce } from '../../../../lib/liveCoalesce';
import { liveProductOf, liveVariationOf } from '../../../../lib/livePrices';
import { isPosInt } from '../../../../lib/validate';
import { budgetSpentResponse, liveBudget, LiveBudgetSpent } from '../../../../lib/liveBudget';

export const prerender = false;

// One product's live price and stock, plus each variation's for a variable product:
// GET /api/live/product/<id>/. No-store, read from WooCommerce every call (see api/live/index.ts). Each WooCommerce
// call takes a token from the process-wide budget (lib/liveBudget).
const WINDOW_MS = 60 * 1000;
const requests = createLimiter(120, WINDOW_MS);

export const GET: APIRoute = async (ctx) => {
  const raw = ctx.params.id ?? '';
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!isPosInt(id)) return jsonResponse({ message: 'Ógild auðkenni vöru.' }, 400);
  if (!requests.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);
  try {
    const answer = await coalesce(`product:${id}`, async () => {
      const [product] = await liveBudget.upstream(() => getProductsByIds([id], 1, LIVE_PRODUCT_FIELDS));
      if (!product) return null;
      const variations = product.type === 'variable' ? (await liveBudget.upstream(() => getVariationStock(id))).map((v) => liveVariationOf(v, product)) : [];
      return { product: liveProductOf(product), variations };
    });
    if (!answer) return jsonResponse({ message: 'Vara fannst ekki.' }, 404);
    return jsonResponse(answer, 200);
  } catch (err) {
    if (err instanceof LiveBudgetSpent) return budgetSpentResponse();
    return jsonResponse({ message: 'Lagerstaða fæst ekki í augnablikinu.' }, 502);
  }
};
