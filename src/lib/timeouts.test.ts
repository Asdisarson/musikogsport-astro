// LM-02: every caller on the money path waits longer than the work it waits on, so the browser never gives up on a
// call the server is still waiting on (its answer, and the rotated Cart-Token cookie in it, would be lost, and the next
// queued cart call would start while the first is still running).
import { describe, expect, it } from 'vitest';
import {
  CART_CLIENT_TIMEOUT_MS,
  CHECKOUT_CLIENT_TIMEOUT_MS,
  CHECKOUT_RECOVERY_POLL,
  STORE_API_TIMEOUT_MS,
  WOO_REST_TIMEOUT_MS,
  storeBudgetLeft,
} from './timeouts';

describe('money-path time budgets (LM-02)', () => {
  it('the browser waits longer for a cart call than the server waits for the Store API', () => {
    expect(STORE_API_TIMEOUT_MS).toBe(25_000);
    expect(CART_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(STORE_API_TIMEOUT_MS + 3_000);
  });

  it('the browser waits for placing an order longer than the checkout call plus the recovery lookup after it', () => {
    // /api/checkout: the Store API checkout (25 s at most), then on a time-out one WooCommerce REST read (LM-01).
    expect(CHECKOUT_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(STORE_API_TIMEOUT_MS + WOO_REST_TIMEOUT_MS + 5_000);
  });

  it('the recovery poll gives WordPress time to finish an order the storefront stopped waiting for', () => {
    const { tries, intervalMs } = CHECKOUT_RECOVERY_POLL;
    expect(tries).toBeGreaterThanOrEqual(3);
    expect(tries * intervalMs).toBeGreaterThanOrEqual(15_000);
  });
});

describe('storeBudgetLeft: one Store API budget for a request that makes two calls', () => {
  it('is what the first call left of the budget, so both together still answer before the browser gives up', () => {
    expect(storeBudgetLeft(0)).toBe(STORE_API_TIMEOUT_MS);
    expect(storeBudgetLeft(20_000)).toBe(5_000);
    expect(20_000 + storeBudgetLeft(20_000)).toBeLessThan(CART_CLIENT_TIMEOUT_MS);
  });

  it('never goes below 1 ms: a spent budget makes the second call time out at once instead of waiting again', () => {
    expect(storeBudgetLeft(STORE_API_TIMEOUT_MS)).toBe(1);
    expect(storeBudgetLeft(60_000)).toBe(1);
    expect(storeBudgetLeft(-5)).toBe(STORE_API_TIMEOUT_MS);
  });
});
