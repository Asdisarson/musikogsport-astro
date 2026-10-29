// POST /api/contact (PA-03 in part, PA-15): an incomplete form never reaches WordPress (verify_content_pages.py relies
// on it), outages are logged as JSON lines, and only real attempts use the visitor's slots.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
const { POST } = await import('../pages/api/contact');

let ip = 0;
function ctx(body: unknown, opts: { addr?: string; form?: boolean } = {}) {
  const url = new URL('https://musikogsport.is/api/contact');
  const request = opts.form
    ? new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body as Record<string, string>) })
    : new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    request,
    url,
    clientAddress: opts.addr ?? `10.9.0.${++ip}`,
    redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
  } as never;
}
const full = { name: 'Anna', email: 'a@b.is', topic: 'almennt', message: 'Halló' };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/contact', () => {
  it('rejects an incomplete form with 400 before any WordPress call', async () => {
    const res = (await POST(ctx({ name: 'x' }))) as Response;
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const form = (await POST(ctx({ name: 'x' }, { form: true }))) as Response;
    expect(form.status).toBe(303);
    expect(form.headers.get('Location')).toBe('/hafa-samband/?error=1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a complete form and answers ok', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const res = (await POST(ctx(full))) as Response;
    expect(res.status).toBe(200);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual(full);
  });

  it('logs a WordPress outage as one JSON line, answers 502 and refunds the slot', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const addr = '10.9.9.9';
    for (let i = 0; i < 6; i++) expect(((await POST(ctx(full, { addr }))) as Response).status).toBe(502); // 6 > the 5-slot limit
    const line = JSON.parse(String(out.mock.calls[0][0]));
    expect(line).toMatchObject({ level: 'warn', msg: '[contact] upstream failure', err: 'TypeError: fetch failed' });
    out.mockRestore();
  });
});
