import type { APIRoute } from 'astro';
import { getProductsByIds, LIVE_PRODUCT_FIELDS } from '../../../lib/woo';
import { jsonResponse, tooManyRequests } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';
import { coalesce } from '../../../lib/liveCoalesce';
import { budgetSpentResponse, liveBudget, LiveBudgetSpent } from '../../../lib/liveBudget';
import { LIVE_MAX_IDS, liveProductOf, parseLiveIds } from '../../../lib/livePrices';

export const prerender = false;

// Live price and stock for the product cards on one page: GET /api/live/?ids=1,2,3. Read from WooCommerce on every
// call and answered no-store, so stock is never held at the server or the CDN. A product that is not published
// is missing from the answer; the card then keeps its neutral state. Limited per visitor: a page view and each
// filter click make one call. The routes share a process-wide budget of WooCommerce calls (lib/liveBudget): spent, they
// answer 503 with Retry-After.
const WINDOW_MS = 60 * 1000;
const requests = createLimiter(120, WINDOW_MS);

export const GET: APIRoute = async (ctx) => {
  const ids = parseLiveIds(ctx.url.searchParams.get('ids'), LIVE_MAX_IDS);
  if (!ids) return jsonResponse({ message: 'Ógild auðkenni vara.' }, 400);
  if (!requests.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);
  try {
    const products = await coalesce(`list:${ids.join(',')}`, () => liveBudget.upstream(() => getProductsByIds(ids, ids.length, LIVE_PRODUCT_FIELDS)));
    return jsonResponse({ products: products.map(liveProductOf) }, 200);
  } catch (err) {
    if (err instanceof LiveBudgetSpent) return budgetSpentResponse();
    return jsonResponse({ message: 'Lagerstaða fæst ekki í augnablikinu.' }, 502);
  }
};
