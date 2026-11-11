// storeApi.ts: transport failures (no answer from WordPress) are told apart from WooCommerce's own answers, so the
// checkout route can recover an order that may have been placed (LM-01) instead of telling the shopper to retry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

describe('storeFetch failure mapping', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks a time-out as a transport failure: 504, no Cart-Token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }));
    const { checkout } = await import('./storeApi');
    const r = await checkout({ billing_address: { email: 'a@b.is' } } as never, 'tok');
    expect(r).toMatchObject({ ok: false, status: 504, cartToken: null, transportFailure: 'timeout' });
  });

  it('marks a dropped connection as a transport failure: 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { getCart } = await import('./storeApi');
    const r = await getCart('tok');
    expect(r).toMatchObject({ ok: false, status: 502, cartToken: null, transportFailure: 'network' });
  });

  it('SR-01: an answer cut off while its body is read (headers arrived, then the time-out or a reset) is a transport failure, not a throw', async () => {
    const cut = (err: Error) => () =>
      new Response(
        new ReadableStream({
          pull() {
            throw err;
          },
        }),
        { status: 200, headers: { 'Cart-Token': 'tok2' } },
      );
    const { checkout } = await import('./storeApi');
    vi.stubGlobal('fetch', vi.fn(async () => cut(new DOMException('The operation timed out.', 'TimeoutError'))()));
    expect(await checkout({ billing_address: { email: 'a@b.is' } } as never, 'tok')).toMatchObject({
      ok: false, status: 504, cartToken: null, transportFailure: 'timeout',
    });
    vi.stubGlobal('fetch', vi.fn(async () => cut(new TypeError('terminated'))()));
    expect(await checkout({ billing_address: { email: 'a@b.is' } } as never, 'tok')).toMatchObject({
      ok: false, status: 502, cartToken: null, transportFailure: 'network',
    });
  });

  it("leaves WooCommerce's own answers unmarked (an error from WooCommerce is final)", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"x","message":"Nei"}', { status: 400, headers: { 'Cart-Token': 'tok2' } })));
    const { checkout } = await import('./storeApi');
    const r = await checkout({ billing_address: { email: 'a@b.is' } } as never, 'tok');
    expect(r).toMatchObject({ ok: false, status: 400, cartToken: 'tok2', data: { code: 'x' } });
    expect(r.transportFailure).toBeUndefined();
  });

  it('waits STORE_API_TIMEOUT_MS for an answer (LM-02)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { getCart } = await import('./storeApi');
    const { STORE_API_TIMEOUT_MS } = await import('./timeouts');
    await getCart('tok');
    expect(spy).toHaveBeenCalledWith(STORE_API_TIMEOUT_MS);
  });

  it('waits only as long as the caller says when the request already spent part of its budget', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { addItem } = await import('./storeApi');
    await addItem({ id: 5, quantity: 1 }, 'tok', 5_000);
    expect(spy).toHaveBeenLastCalledWith(5_000);
  });
});
