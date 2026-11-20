// A process-wide cap on the WooCommerce calls /api/live makes. The per-visitor limit (120 a minute per key) does not
// bound the total: a client that rotates its key gets a fresh bucket every time. One token per real upstream call, so
// requests that share a coalesced load share one token. SERVER-ONLY by use.
import { jsonResponse } from './http';
import { createLimiter } from './rateLimit';
import { log } from './logger';

/** Upstream calls per minute, all visitors together. Sized from a page view of about 1-2 calls (one per chunk of
 *  cards, one for a product page, one per variable product) and a filter click per call: 600 is three times a
 *  busy minute (about 200 calls) and well under what WooCommerce answered before the live cards (see DEPLOY.md). */
export const LIVE_UPSTREAM_PER_MINUTE = 600;
export const LIVE_BUDGET_WINDOW_MS = 60 * 1000;

export class LiveBudgetSpent extends Error {
  constructor() {
    super('live upstream budget spent');
  }
}

export interface LiveBudget {
  /** Runs one upstream call under the budget, or throws LiveBudgetSpent without calling it. The call gets `spend`: it
   *  takes one more token, and throws LiveBudgetSpent when none is left, so a call that makes several WooCommerce
   *  requests (a variable product's variations come in pages) calls it before each request after the first. */
  upstream<T>(call: (spend: () => void) => Promise<T>): Promise<T>;
}

export function createLiveBudget(opts: { limit?: number; windowMs?: number; now?: () => number; warn?: (n: number) => void } = {}): LiveBudget {
  const windowMs = opts.windowMs ?? LIVE_BUDGET_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const limiter = createLimiter(opts.limit ?? LIVE_UPSTREAM_PER_MINUTE, windowMs, now);
  let lastWarn = -Infinity;
  const warn = opts.warn ?? ((n: number) => log.warn('[api/live] upstream budget spent; cards stay neutral', { limit: n }));
  const spend = (): void => {
    if (limiter.take('woo')) return;
    // one line per window, not one per refused request
    if (now() - lastWarn >= windowMs) {
      lastWarn = now();
      warn(opts.limit ?? LIVE_UPSTREAM_PER_MINUTE);
    }
    throw new LiveBudgetSpent();
  };
  return {
    async upstream(call) {
      spend();
      return call(spend);
    },
  };
}

/** The shared budget for /api/live (both routes). */
export const liveBudget = createLiveBudget();

/** 503 with no-store and Retry-After (the window's length): the cards stay neutral, the PDP shows its retry state. */
export function budgetSpentResponse(): Response {
  const res = jsonResponse({ message: 'Lagerstaða fæst ekki í augnablikinu.' }, 503);
  res.headers.set('Retry-After', String(LIVE_BUDGET_WINDOW_MS / 1000));
  return res;
}
