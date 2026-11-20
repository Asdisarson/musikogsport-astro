// GET /api/waitlist: the signed-in customer's address, for the form to start with ('' for a visitor).
// POST /api/waitlist: the product page's back-in-stock sign-up. A signed-in session's token goes along, so WordPress
// can list the account's own address at once; `confirm` says whether a confirmation mail was sent. Only a same-origin, well-formed address and product id
// from a visitor with slots left reach WordPress (mos/v1/waitlist); a filled honeypot is answered like a success
// without a call; WordPress's wording is never passed on; outages are logged and do not cost the visitor a slot.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
const auth = { token: null as string | null, user: null as { id: number; name: string; email: string } | null };
vi.mock('./auth', () => ({ readAuthToken: () => auth.token, currentUser: async () => auth.user }));
const { GET, POST } = await import('../pages/api/waitlist');

let ip = 0;
function ctx(body: unknown, opts: { addr?: string; origin?: string } = {}) {
  const url = new URL('https://musikogsport.is/api/waitlist');
  const request = new Request(url, {
    method: 'POST',
    headers: { Origin: opts.origin ?? url.origin, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { request, url, cookies: {}, clientAddress: opts.addr ?? `10.9.0.${++ip}` } as never;
}
const fetchMock = vi.fn<typeof fetch>();
const sent = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
const post = async (body: unknown, opts?: { addr?: string; origin?: string }) => (await POST(ctx(body, opts))) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{"ok":true,"confirm":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  auth.token = null;
  auth.user = null;
});

describe('GET /api/waitlist', () => {
  it('answers the signed-in customer\'s address, never stored', async () => {
    auth.user = { id: 7, name: 'Anna', email: 'anna@b.is' };
    const res = (await GET(ctx({}))) as Response;
    expect(await res.json()).toEqual({ email: 'anna@b.is' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers an empty address for a visitor', async () => {
    expect(await ((await GET(ctx({}))) as Response).json()).toEqual({ email: '' });
  });
});

describe('POST /api/waitlist', () => {
  it('refuses another origin before anything else', async () => {
    expect((await post({ email: 'a@b.is', productId: 5 }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed address with 400 before any WordPress call', async () => {
    for (const email of ['', 'anna', 'anna@', 'a b@c.is', 'a@b', `${'x'.repeat(250)}@b.is`]) {
      const res = await post({ email, productId: 5 });
      expect(res.status, email).toBe(400);
      expect(await res.json()).toEqual({ ok: false, message: 'Athugaðu netfangið og reyndu aftur.' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a product id that is not a positive whole number with 400', async () => {
    for (const productId of [undefined, 0, -3, 1.5, '12abc', 'x', null, [5], 1e12]) {
      expect((await post({ email: 'a@b.is', productId })).status, String(productId)).toBe(400);
    }
    expect((await post('not json')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the trimmed address and the product id, and answers ok', async () => {
    const res = await post({ email: '  Anna@B.is ', productId: '228396', website: '', extra: 'x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirm: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://wp.test/wp-json/mos/v1/waitlist');
    expect(sent()).toEqual({ email: 'Anna@B.is', product_id: 228396 });
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).has('Authorization')).toBe(false);
  });

  it('passes a signed-in session\'s token on, and says when no confirmation mail was needed', async () => {
    auth.token = 'aaa.bbb.ccc';
    expect((await post({ email: 'anna@b.is', productId: 5 })).status).toBe(200);
    // a token WordPress no longer takes (no user for it) is left out: the sign-up goes through as a visitor's
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).has('Authorization')).toBe(false);
    fetchMock.mockClear();
    auth.user = { id: 7, name: 'Anna', email: 'anna@b.is' };
    fetchMock.mockImplementation(async () => new Response('{"ok":true,"confirm":false}', { status: 200 }));
    const res = await post({ email: 'anna@b.is', productId: 5 });
    expect(await res.json()).toEqual({ ok: true, confirm: false });
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Authorization')).toBe('Bearer aaa.bbb.ccc');
  });

  it('answers a filled honeypot like a success, without calling WordPress', async () => {
    const res = await post({ email: 'bot@b.is', productId: 5, website: 'https://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirm: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits a visitor to 5 sign-ups per window', async () => {
    const addr = '10.9.8.8';
    for (let i = 0; i < 5; i++) expect((await post({ email: `a${i}@b.is`, productId: 5 }, { addr })).status).toBe(200);
    const res = await post({ email: 'a6@b.is', productId: 5 }, { addr });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, message: 'Of margar skráningar. Reyndu aftur síðar.' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('says so when the product is back in stock (409) or gone (404), without WordPress\'s wording', async () => {
    fetchMock.mockImplementation(async () => new Response('{"code":"mos_waitlist_in_stock","message":"internal detail"}', { status: 409 }));
    const back = await post({ email: 'a@b.is', productId: 5 });
    expect(back.status).toBe(409);
    expect(await back.json()).toEqual({ ok: false, message: 'Varan er komin aftur á lager. Endurhlaðið síðuna til að setja hana í körfu.' });
    fetchMock.mockImplementation(async () => new Response('{"message":"internal detail"}', { status: 404 }));
    const gone = await post({ email: 'a@b.is', productId: 5 });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ ok: false, message: 'Ekki tókst að skrá á biðlista. Reyndu aftur síðar.' });
  });

  it('logs a WordPress refusal that is not the visitor\'s, and refunds the slot on a 5xx', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const status of [400, 409, 429]) {
      fetchMock.mockImplementation(async () => new Response('{}', { status }));
      expect((await post({ email: 'a@b.is', productId: 5 })).status).toBe(status);
    }
    expect(out).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503 }));
    const addr = '10.9.7.7';
    for (let i = 0; i < 6; i++) expect((await post({ email: 'a@b.is', productId: 5 }, { addr })).status).toBe(503); // 6 > the 5-slot limit
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ level: 'warn', msg: '[waitlist] WordPress answered 503', productId: 5 });
    out.mockRestore();
  });

  it('logs an outage without the address, answers 502 and refunds the slot', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const addr = '10.9.9.9';
    for (let i = 0; i < 6; i++) expect((await post({ email: 'a@b.is', productId: 5 }, { addr })).status).toBe(502);
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ level: 'warn', msg: '[waitlist] upstream failure' });
    expect(JSON.stringify(out.mock.calls)).not.toContain('a@b.is');
    out.mockRestore();
  });
});
