// POST /api/newsletter: the footer's mailing-list sign-up. Only a same-origin, well-formed address from a visitor
// with slots left reaches WordPress; a filled honeypot is answered like a success without one; outages are logged
// as JSON lines and do not cost the visitor a slot.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
const { POST } = await import('../pages/api/newsletter');

let ip = 0;
function ctx(body: unknown, opts: { addr?: string; form?: boolean; origin?: string; referer?: string } = {}) {
  const url = new URL('https://musikogsport.is/api/newsletter');
  const headers: Record<string, string> = { Origin: opts.origin ?? url.origin };
  if (opts.referer) headers.Referer = opts.referer;
  headers['Content-Type'] = opts.form ? 'application/x-www-form-urlencoded' : 'application/json';
  const request = new Request(url, { method: 'POST', headers, body: opts.form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body) });
  return {
    request,
    url,
    clientAddress: opts.addr ?? `10.8.0.${++ip}`,
    redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
  } as never;
}
const fetchMock = vi.fn<typeof fetch>();
const sent = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{"ok":true,"confirm":true}', { status: 200 }));   // a fresh body per call
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/newsletter', () => {
  it('refuses another origin before anything else', async () => {
    const res = (await POST(ctx({ email: 'a@b.is' }, { origin: 'https://evil.example' }))) as Response;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed address with 400 before any WordPress call', async () => {
    for (const email of ['', 'anna', 'anna@', 'a b@c.is', 'a@b', `${'x'.repeat(250)}@b.is`]) {
      expect(((await POST(ctx({ email }))) as Response).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const form = (await POST(ctx({ email: 'anna' }, { form: true }))) as Response;
    expect(form.status).toBe(303);
    expect(form.headers.get('Location')).toBe('/?postlisti=0#postlisti');
  });

  it('forwards only the trimmed address and answers ok', async () => {
    const res = (await POST(ctx({ email: '  Anna@B.is ', website: '', extra: 'x' }))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirm: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://wp.test/wp-json/mos/v1/newsletter');
    expect(sent()).toEqual({ email: 'Anna@B.is' });
    const form = (await POST(ctx({ email: 'a@b.is' }, { form: true }))) as Response;
    expect(form.headers.get('Location')).toBe('/?postlisti=1#postlisti');
  });

  it('sends a no-JS post back to the page it came from, never off the site', async () => {
    const back = async (referer: string) => ((await POST(ctx({ email: 'a@b.is' }, { form: true, referer }))) as Response).headers.get('Location');
    expect(await back('https://musikogsport.is/verslun/skor/?page=2&postlisti=0#top')).toBe('/verslun/skor/?postlisti=1#postlisti');
    expect(await back('https://evil.example/phish/')).toBe('/?postlisti=1#postlisti');
    expect(await back('https://musikogsport.is/api/newsletter')).toBe('/?postlisti=1#postlisti');
    expect(await back('not a url')).toBe('/?postlisti=1#postlisti');
    expect(await back('https://musikogsport.is//evil.example/x')).toBe('/evil.example/x?postlisti=1#postlisti');
  });

  it('says when the audience adds addresses without a confirmation mail', async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":true,"confirm":false}', { status: 200 }));
    expect(await ((await POST(ctx({ email: 'a@b.is' }))) as Response).json()).toEqual({ ok: true, confirm: false });
    const form = (await POST(ctx({ email: 'a@b.is' }, { form: true }))) as Response;
    expect(form.headers.get('Location')).toBe('/?postlisti=2#postlisti');
  });

  it('answers a filled honeypot like a success, without calling WordPress', async () => {
    const res = (await POST(ctx({ email: 'bot@b.is', website: 'https://spam.example' }))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirm: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits a visitor to 5 sign-ups per window', async () => {
    const addr = '10.8.8.8';
    for (let i = 0; i < 5; i++) expect(((await POST(ctx({ email: `a${i}@b.is` }, { addr }))) as Response).status).toBe(200);
    const res = (await POST(ctx({ email: 'a6@b.is' }, { addr }))) as Response;
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('passes on a WordPress refusal without its wording, and never says whether the address was known', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"mos_newsletter_not_configured","message":"internal detail"}', { status: 503 }));
    const res = (await POST(ctx({ email: 'a@b.is' }))) as Response;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, message: 'Ekki tókst að skrá netfangið. Reyndu aftur síðar.' });
  });

  it('logs any WordPress refusal that is not the visitor\'s (a missing route, a firewall), not a 400 or 429', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const status of [400, 429]) {
      fetchMock.mockImplementation(async () => new Response('{}', { status }));
      expect(((await POST(ctx({ email: 'a@b.is' }))) as Response).status).toBe(status);
    }
    expect(out).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => new Response('{"code":"rest_no_route"}', { status: 404 }));
    expect(((await POST(ctx({ email: 'a@b.is' }))) as Response).status).toBe(404);
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ level: 'warn', msg: '[newsletter] WordPress answered 404' });
    out.mockRestore();
  });

  it('logs an outage as one JSON line, answers 502 and refunds the slot', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const addr = '10.8.9.9';
    for (let i = 0; i < 6; i++) expect(((await POST(ctx({ email: 'a@b.is' }, { addr }))) as Response).status).toBe(502); // 6 > the 5-slot limit
    const line = JSON.parse(String(out.mock.calls[0][0]));
    expect(line).toMatchObject({ level: 'warn', msg: '[newsletter] upstream failure', err: 'TypeError: fetch failed' });
    expect(JSON.stringify(out.mock.calls)).not.toContain('a@b.is');
    out.mockRestore();
  });
});
