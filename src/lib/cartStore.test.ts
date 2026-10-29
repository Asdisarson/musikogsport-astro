// cartStore.ts, the browser's mirror of the Store API cart. Runs in node with a fake fetch (no request leaves).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from './types';

const cartWith = (qty: number): Cart => ({
  items: [{ key: 'line1', id: 5, quantity: qty } as never], items_count: qty, coupons: [], needs_payment: true, needs_shipping: true,
  has_calculated_shipping: false, shipping_rates: [], shipping_address: {}, billing_address: {}, totals: { total_price: '0' } as never,
  payment_methods: [], errors: [],
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function freshStore() {
  vi.resetModules();
  return import('./cartStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cart calls wait longer than the server (LM-02)', () => {
  it('uses CART_CLIENT_TIMEOUT_MS for every cart call', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => json(200, cartWith(1))));
    const s = await freshStore();
    const { CART_CLIENT_TIMEOUT_MS } = await import('./timeouts');
    await s.refreshCart();
    expect(spy).toHaveBeenCalledWith(CART_CLIENT_TIMEOUT_MS);
  });

  it('after a call the server gave up on (502/504) or no answer, the next queued call waits for WordPress to finish', async () => {
    vi.useFakeTimers();
    const f = vi.fn()
      .mockResolvedValueOnce(json(504, { message: 'Þjónustan svaraði ekki, reyndu aftur.' }))
      .mockResolvedValueOnce(json(200, cartWith(2)));
    vi.stubGlobal('fetch', f);
    const s = await freshStore();
    const first = s.updateQty('line1', 2).catch((e: Error) => e.message);
    const second = s.updateQty('line1', 2);
    expect(await first).toBe('Þjónustan svaraði ekki, reyndu aftur.'); // the shopper hears at once
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1); // the next call has not gone out yet
    await vi.advanceTimersByTimeAsync(s.CART_COOLDOWN_MS);
    await second;
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a refusal from WooCommerce (4xx) does not hold the queue', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(400, { message: 'Ógildur kóði' }))
      .mockResolvedValueOnce(json(200, cartWith(1)));
    vi.stubGlobal('fetch', f);
    const s = await freshStore();
    await expect(s.applyCoupon('x')).rejects.toThrow('Ógildur kóði');
    await s.refreshCart();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('a 200 that is not a cart (LM-12b)', () => {
  it('is an error, not an empty mirror', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy</html>', { status: 200 })));
    const s = await freshStore();
    await expect(s.refreshCart()).rejects.toThrow();
    expect(s.cart.get()).toBeNull();
    expect(s.cartError.get()).toBeTruthy();
  });
});

describe('first load failure and retry (CO-01)', () => {
  it('cartViewState says error (not loading) when the first load failed, and retry recovers', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(503, { message: 'Ekki tókst að sækja körfuna.' })).mockResolvedValueOnce(json(200, cartWith(1)));
    vi.stubGlobal('fetch', f);
    const s = await freshStore();
    const { cartViewState } = await import('./cartView');
    expect(cartViewState(s.cart.get(), s.cartError.get())).toBe('loading');
    s.ensureLoaded();
    await vi.waitFor(() => expect(s.cartError.get()).toBe('Ekki tókst að sækja körfuna.'));
    expect(cartViewState(s.cart.get(), s.cartError.get())).toBe('error');
    s.retryCartLoad();
    expect(cartViewState(s.cart.get(), s.cartError.get())).toBe('loading');
    await vi.waitFor(() => expect(s.cart.get()?.items_count).toBe(1));
    expect(cartViewState(s.cart.get(), s.cartError.get())).toBe('ready');
  });

  it('cartViewState: empty and ready', async () => {
    const { cartViewState } = await import('./cartView');
    expect(cartViewState({ ...cartWith(1), items: [] }, null)).toBe('empty');
    expect(cartViewState(cartWith(1), 'an error from a write')).toBe('ready'); // a loaded cart keeps showing
  });
});

describe('quick stepper clicks (CO-06)', () => {
  it('three fast "+" clicks ask for +1, +2, +3 in order', async () => {
    const sent: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_p: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).quantity;
      sent.push(q);
      return json(200, cartWith(q));
    }));
    const s = await freshStore();
    s.cart.set(cartWith(2));
    await Promise.all([s.stepQty('line1', 1), s.stepQty('line1', 1), s.stepQty('line1', 1)]);
    expect(sent).toEqual([3, 4, 5]);
    expect(s.cart.get()?.items[0].quantity).toBe(5);
    // once settled, the next click starts from the cart again
    await s.stepQty('line1', -1);
    expect(sent.at(-1)).toBe(4);
  });

  it('never goes below 1 or above 99', async () => {
    const sent: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_p: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).quantity;
      sent.push(q);
      return json(200, cartWith(q));
    }));
    const s = await freshStore();
    s.cart.set(cartWith(1));
    await s.stepQty('line1', -1); // already 1: nothing to send
    s.cart.set(cartWith(99));
    await s.stepQty('line1', 1);
    expect(sent).toEqual([]);
  });

  it('a failed step lets the next click start from the cart', async () => {
    const sent: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_p: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).quantity;
      sent.push(q);
      return q === 3 ? json(400, { message: 'Ekki til á lager' }) : json(200, cartWith(q));
    }));
    const s = await freshStore();
    s.cart.set(cartWith(2));
    await s.stepQty('line1', 1).catch(() => {});
    await s.stepQty('line1', 1).catch(() => {});
    expect(sent).toEqual([3, 3]);
  });
});

describe('refresh on return (CO-05)', () => {
  let target: EventTarget;
  let doc: EventTarget & { visibilityState: string };
  beforeEach(() => {
    target = new EventTarget();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  });
  const pageshow = (persisted: boolean) => Object.assign(new Event('pageshow'), { persisted });

  it('re-reads the cart on a bfcache restore, and on tab return at most once per CART_RESYNC_GAP_MS', async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => json(200, cartWith(1)));
    vi.stubGlobal('fetch', f);
    const s = await freshStore();
    s.ensureLoaded();
    s.watchCartFreshness(target, doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);

    target.dispatchEvent(pageshow(false)); // a normal load: nothing extra
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(1);
    target.dispatchEvent(pageshow(true)); // restored from the bfcache: always re-read
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);

    doc.dispatchEvent(new Event('visibilitychange')); // too soon after the last read
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(s.CART_RESYNC_GAP_MS);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange')); // leaving the tab: nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('does nothing before the cart was ever loaded on this page', async () => {
    const f = vi.fn(async () => json(200, cartWith(1)));
    vi.stubGlobal('fetch', f);
    const s = await freshStore();
    s.watchCartFreshness(target, doc);
    target.dispatchEvent(pageshow(true));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(f).not.toHaveBeenCalled();
  });
});
