// LM-11: the cart/checkout/session libraries' behaviour, pinned with a fake fetch and fake cookies (batch A, tests
// only). Batch M changed one pinned answer on purpose: storeFetch marks a lost answer (transportFailure, LM-01).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));

/** Just enough of AstroCookies: get / set / delete, with what was set kept for inspection. */
function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const sets: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  return {
    jar,
    sets,
    deleted,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown> = {}) => {
      jar.set(name, value);
      sets.push({ name, value, opts });
    },
    delete: (name: string) => {
      jar.delete(name);
      deleted.push(name);
    },
  };
}
const ctxWith = (cookies: ReturnType<typeof fakeCookies>) => ({ cookies }) as never;

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('storeApi.storeFetch (via getCart / addItem / checkout)', () => {
  it('sends the Cart-Token, returns the parsed body and the rotated token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Cart-Token': 'tok-2' } }));
    const { addItem } = await import('./storeApi');
    const r = await addItem({ id: 5, quantity: 1 }, 'tok-1');
    expect(r).toEqual({ status: 200, ok: true, data: { items: [] }, cartToken: 'tok-2' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://wp.test/wp-json/wc/store/v1/cart/add-item');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Cart-Token']).toBe('tok-1');
    expect(JSON.parse(String(init.body))).toEqual({ id: 5, quantity: 1 });
  });

  it('passes a WooCommerce error through with its status, and a non-JSON body as text', async () => {
    const { getCart } = await import('./storeApi');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'woocommerce_rest_cart_invalid_key', message: 'x' }), { status: 409 }));
    expect(await getCart('t')).toMatchObject({ status: 409, ok: false, data: { code: 'woocommerce_rest_cart_invalid_key' }, cartToken: null });
    fetchMock.mockResolvedValue(new Response('<html>oops', { status: 500 }));
    expect(await getCart('t')).toMatchObject({ status: 500, ok: false, data: '<html>oops' });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect((await getCart('t')).data).toBeNull();
  });

  it('turns a transport failure into 502 and a timeout into 504, with the retry message and no token', async () => {
    const { checkout } = await import('./storeApi');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    // Batch M (LM-01): a lost answer is also marked as such, so the checkout route recovers instead of failing.
    expect(await checkout({} as never, 't')).toEqual({ status: 502, ok: false, data: { message: 'Þjónustan svaraði ekki, reyndu aftur.' }, cartToken: null, transportFailure: 'network' });
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect((await checkout({} as never, 't')).status).toBe(504);
  });
});

describe('cartProxy', () => {
  it('readOrderCookie accepts only {id:number, key:non-empty string}; seen defaults to false', async () => {
    const { readOrderCookie } = await import('./cartProxy');
    const read = (v?: string) => readOrderCookie(ctxWith(fakeCookies(v === undefined ? {} : { mos_order: v })));
    expect(read(JSON.stringify({ id: 7, key: 'wc_order_x', seen: true }))).toEqual({ id: 7, key: 'wc_order_x', seen: true });
    expect(read(JSON.stringify({ id: 7, key: 'wc_order_x' }))).toEqual({ id: 7, key: 'wc_order_x', seen: false });
    for (const bad of [undefined, '', '{', 'null', '[]', JSON.stringify({ id: '7', key: 'k' }), JSON.stringify({ id: 7, key: '' }), JSON.stringify({ id: 7, key: 5 })]) {
      expect(read(bad)).toBeNull();
    }
  });

  it('writeOrderCookie stores id/key/seen httpOnly for 2 h, and refuses an incomplete order', async () => {
    const { writeOrderCookie } = await import('./cartProxy');
    const c = fakeCookies();
    writeOrderCookie(ctxWith(c), { order_id: 9, order_key: 'wc_order_k' });
    writeOrderCookie(ctxWith(c), { order_id: 0, order_key: 'x' });
    writeOrderCookie(ctxWith(c), { order_id: 9, order_key: '' });
    expect(c.sets).toHaveLength(1);
    expect(JSON.parse(c.sets[0].value)).toEqual({ id: 9, key: 'wc_order_k', seen: false });
    expect(c.sets[0].opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7200 });
  });

  it('writeToken keeps the existing cookie when the response carried no token', async () => {
    const { writeToken, readToken, clearToken } = await import('./cartProxy');
    const c = fakeCookies({ wc_cart_token: 'old' });
    writeToken(ctxWith(c), null);
    writeToken(ctxWith(c), '');
    expect(readToken(ctxWith(c))).toBe('old');
    writeToken(ctxWith(c), 'new');
    expect(readToken(ctxWith(c))).toBe('new');
    expect(c.sets[0].opts).toMatchObject({ httpOnly: true, maxAge: 172800 });
    clearToken(ctxWith(c));
    expect(readToken(ctxWith(c))).toBeNull();
  });

  it('cartSession reuses the cookie, else primes a cart and stores its token (current behaviour: a failed prime still returns)', async () => {
    const { cartSession } = await import('./cartProxy');
    const ensureToken = async (c: Parameters<typeof cartSession>[0]) => (await cartSession(c)).token;
    const has = fakeCookies({ wc_cart_token: 'mine' });
    expect(await ensureToken(ctxWith(has))).toBe('mine');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Cart-Token': 'primed' } }));
    const none = fakeCookies();
    expect(await ensureToken(ctxWith(none))).toBe('primed');
    expect(none.jar.get('wc_cart_token')).toBe('primed');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await ensureToken(ctxWith(fakeCookies()))).toBeNull(); // LM-05 (open): the caller goes on without a token
  });

  it('respondCart rotates the token and answers the Store API body, no-store', async () => {
    const { respondCart } = await import('./cartProxy');
    const c = fakeCookies({ wc_cart_token: 'old' });
    const res = respondCart(ctxWith(c), { status: 201, ok: true, data: { items: [1] }, cartToken: 'new' });
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [1] });
    expect(c.jar.get('wc_cart_token')).toBe('new');
  });
});

describe('auth', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let n = 0;
  /** A distinct token-shaped value per test: auth's memo is module state. */
  const token = () => `aaa.bbb${++n}.ccc`;

  it('requestToken: token on success; rejected on 401 or a jwt_auth 403; unavailable otherwise', async () => {
    const { requestToken } = await import('./auth');
    fetchMock.mockResolvedValueOnce(json({ token: 'x.y.z' }));
    expect(await requestToken('u', 'p')).toEqual({ token: 'x.y.z' });
    fetchMock.mockResolvedValueOnce(json({ code: '[jwt_auth] incorrect_password' }, 403));
    expect(await requestToken('u', 'p')).toEqual({ error: 'rejected' });
    fetchMock.mockResolvedValueOnce(json({}, 401));
    expect(await requestToken('u', 'p')).toEqual({ error: 'rejected' });
    fetchMock.mockResolvedValueOnce(json({ code: 'waf' }, 403));
    expect(await requestToken('u', 'p')).toEqual({ error: 'unavailable' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await requestToken('u', 'p')).toEqual({ error: 'unavailable' });
  });

  it('currentUser: the WordPress user for a valid token, memoised; concurrent checks share one call', async () => {
    const { currentUser } = await import('./auth');
    const t = token();
    fetchMock.mockResolvedValue(json({ id: 7, name: 'Anna', email: 'a@b.is' }));
    const c = fakeCookies({ mos_auth: t });
    const [a, b] = await Promise.all([currentUser(c as never), currentUser(c as never)]);
    expect(a).toEqual({ id: 7, name: 'Anna', email: 'a@b.is', canEditProducts: false });
    expect(b).toEqual(a);
    await currentUser(c as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${t}` });
  });

  it('currentUser: staff are the accounts WordPress grants edit_products', async () => {
    const { currentUser } = await import('./auth');
    fetchMock.mockResolvedValue(json({ id: 1, name: 'Eigandi', email: 'e@b.is', capabilities: { edit_products: true } }));
    const user = await currentUser(fakeCookies({ mos_auth: token() }) as never);
    expect(user?.canEditProducts).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('capabilities');
  });

  it('currentUser: no call and the cookie dropped for a value that is not token-shaped', async () => {
    const { currentUser } = await import('./auth');
    const c = fakeCookies({ mos_auth: 'not-a-token', mos_li: '1' });
    expect(await currentUser(c as never)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(c.deleted).toEqual(['mos_auth', 'mos_li']);
  });

  it('currentUser: a refused token clears the cookies; an outage keeps them (the visitor just looks signed out)', async () => {
    const { currentUser } = await import('./auth');
    fetchMock.mockResolvedValueOnce(json({ code: 'jwt_auth_invalid_token' }, 403));
    const refused = fakeCookies({ mos_auth: token(), mos_li: '1' });
    expect(await currentUser(refused as never)).toBeNull();
    expect(refused.deleted).toEqual(['mos_auth', 'mos_li']);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const down = fakeCookies({ mos_auth: token(), mos_li: '1' });
    expect(await currentUser(down as never)).toBeNull();
    expect(down.deleted).toEqual([]);
  });

  it('revokeToken: a known session is refused at once, even before WordPress answers, and stays refused', async () => {
    const { currentUser, revokeToken, verifiedUser } = await import('./auth');
    const t = token();
    fetchMock.mockResolvedValueOnce(json({ id: 8, name: 'B', email: 'b@b.is' }));
    expect(await currentUser(fakeCookies({ mos_auth: t }) as never)).toMatchObject({ id: 8 });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')); // WordPress down for the logout
    await revokeToken(t);
    expect(await verifiedUser(t)).toBeNull();
    expect(await verifiedUser(t, true)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateUser makes a memoised session of that customer ask WordPress again', async () => {
    const { currentUser, invalidateUser } = await import('./auth');
    const t = token();
    fetchMock.mockResolvedValue(json({ id: 9, name: 'C', email: 'c@b.is' }));
    const c = fakeCookies({ mos_auth: t });
    await currentUser(c as never);
    await new Promise((r) => setTimeout(r, 2)); // invalidation is by timestamp
    invalidateUser(9);
    await currentUser(c as never);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('setAuth: httpOnly token cookie, session-only unless remembered; the flag records the choice', async () => {
    const { setAuth, rememberedSession, clearAuth } = await import('./auth');
    const c = fakeCookies();
    setAuth(c as never, 'x.y.z', false);
    expect(c.sets[0]).toMatchObject({ name: 'mos_auth', value: 'x.y.z', opts: { httpOnly: true, sameSite: 'lax', maxAge: undefined } });
    expect(c.sets[1]).toMatchObject({ name: 'mos_li', value: '1', opts: { httpOnly: false } });
    expect(rememberedSession(c as never)).toBe(false);
    setAuth(c as never, 'x.y.z', true);
    expect(c.sets[2].opts.maxAge).toBe(7 * 24 * 60 * 60);
    expect(rememberedSession(c as never)).toBe(true);
    clearAuth(c as never);
    expect(c.jar.size).toBe(0);
  });
});
