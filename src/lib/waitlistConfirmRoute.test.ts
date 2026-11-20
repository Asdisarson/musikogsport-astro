// POST /api/waitlist/confirm: the button on /bidlisti/stadfesta/ (the link in the confirmation mail). Only a same-origin,
// token-shaped value from a visitor with slots left reaches WordPress (mos/v1/waitlist/confirm); WordPress's wording
// is never passed on; outages are logged and do not cost the visitor a slot.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
const { POST } = await import('../pages/api/waitlist/confirm');

const TOKEN = 'a1'.repeat(24);
let ip = 0;
function ctx(body: unknown, opts: { addr?: string; origin?: string } = {}) {
  const url = new URL('https://musikogsport.is/api/waitlist/confirm');
  const request = new Request(url, {
    method: 'POST',
    headers: { Origin: opts.origin ?? url.origin, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { request, url, clientAddress: opts.addr ?? `10.7.0.${++ip}` } as never;
}
const fetchMock = vi.fn<typeof fetch>();
const post = async (body: unknown, opts?: { addr?: string; origin?: string }) => (await POST(ctx(body, opts))) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/waitlist/confirm', () => {
  it('refuses another origin before anything else', async () => {
    expect((await post({ token: TOKEN }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a value that is no token like an expired link, without calling WordPress', async () => {
    for (const token of [undefined, '', 'abc', TOKEN.toUpperCase(), `${TOKEN}0`, TOKEN.slice(1), [TOKEN], 12]) {
      const res = await post({ token });
      expect(res.status, String(token)).toBe(404);
      expect(await res.json()).toEqual({ ok: false, message: 'Hlekkurinn er útrunninn eða hefur þegar verið notaður.' });
    }
    expect((await post('not json')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the token alone and answers ok', async () => {
    const res = await post({ token: TOKEN, extra: 'x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://wp.test/wp-json/mos/v1/waitlist/confirm');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ token: TOKEN });
  });

  it('says so for a used or expired link (404) and a product back in stock (409), without WordPress\'s wording', async () => {
    fetchMock.mockImplementation(async () => new Response('{"message":"internal detail"}', { status: 404 }));
    expect(await (await post({ token: TOKEN })).json()).toEqual({ ok: false, message: 'Hlekkurinn er útrunninn eða hefur þegar verið notaður.' });
    fetchMock.mockImplementation(async () => new Response('{"message":"internal detail"}', { status: 409 }));
    const back = await post({ token: TOKEN });
    expect(back.status).toBe(409);
    expect(await back.json()).toEqual({ ok: false, message: 'Varan er komin aftur á lager, svo engin þörf er á biðlista.' });
  });

  it('limits a visitor to 10 tries per window', async () => {
    const addr = '10.7.8.8';
    for (let i = 0; i < 10; i++) expect((await post({ token: TOKEN }, { addr })).status).toBe(200);
    expect((await post({ token: TOKEN }, { addr })).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('logs an outage without the token, answers 502 and refunds the slot', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const addr = '10.7.9.9';
    for (let i = 0; i < 11; i++) expect((await post({ token: TOKEN }, { addr })).status).toBe(502);
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ level: 'warn', msg: '[waitlist] confirm: upstream failure' });
    expect(JSON.stringify(out.mock.calls)).not.toContain(TOKEN);
    out.mockRestore();
  });
});
