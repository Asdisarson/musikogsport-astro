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
