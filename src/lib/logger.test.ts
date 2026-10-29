import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, installProcessHandlers, redactSecrets } from './logger';

describe('redactSecrets', () => {
  it('blanks the WooCommerce REST key and secret in a logged URL', () => {
    const url = 'https://wp.example/wp-json/wc/v3/products?consumer_key=ck_live123&consumer_secret=cs_live456&slug=x';
    const out = redactSecrets(url);
    expect(out).not.toContain('ck_live123');
    expect(out).not.toContain('cs_live456');
    expect(out).toBe('https://wp.example/wp-json/wc/v3/products?consumer_key=[redacted]&consumer_secret=[redacted]&slug=x');
  });

  it('blanks key=, password=, token= and secret-ish params wherever they sit', () => {
    expect(redactSecrets('/api/order?id=5&key=wc_order_abc')).toBe('/api/order?id=5&key=[redacted]');
    expect(redactSecrets('/x?password=hunter2#top')).toBe('/x?password=[redacted]#top');
    expect(redactSecrets('/x?a=1&token=eyJ.a.b&pass=p&api_key=k')).toBe('/x?a=1&token=[redacted]&pass=[redacted]&api_key=[redacted]');
    expect(redactSecrets('reset ?login=bob&key=Zz9')).toBe('reset ?login=bob&key=[redacted]');
  });

  it('works inside free text such as an Error message', () => {
    const msg = 'Failed to parse URL from http://wp/wp-json/wc/v3/orders/1?consumer_key=ck_a&consumer_secret=cs_b';
    expect(redactSecrets(msg)).toBe('Failed to parse URL from http://wp/wp-json/wc/v3/orders/1?consumer_key=[redacted]&consumer_secret=[redacted]');
  });

  it('leaves ordinary query strings alone', () => {
    expect(redactSecrets('/verslun/?kyn=herrar&product-category=skor&monkey=1')).toBe('/verslun/?kyn=herrar&product-category=skor&monkey=1');
  });
});

describe('createLogger', () => {
  const setup = (level?: string) => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l), level, now: () => 0 });
    return { log, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
  };

  it('writes one JSON line with level, msg and the given fields', () => {
    const s = setup();
    s.log.error('request failed', { path: '/verslun/', status: 500, ms: 12 });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).not.toContain('\n');
    expect(s.parsed()[0]).toEqual({ time: new Date(0).toISOString(), level: 'error', msg: 'request failed', path: '/verslun/', status: 500, ms: 12 });
  });

  it('redacts secrets in the message, path and error text', () => {
    const s = setup();
    s.log.warn('GET https://wp/x?consumer_key=ck_1', { path: '/api/order?key=wc_order_2', err: new Error('boom ?consumer_secret=cs_3') });
    const line = s.lines[0];
    for (const secret of ['ck_1', 'wc_order_2', 'cs_3']) expect(line).not.toContain(secret);
    expect(s.parsed()[0].err).toBe('Error: boom ?consumer_secret=[redacted]');
  });

  it('drops lines below the configured level (default info)', () => {
    const s = setup();
    s.log.debug('noise');
    s.log.info('kept');
    expect(s.parsed().map((l) => l.msg)).toEqual(['kept']);
    const w = setup('warn');
    w.log.info('dropped');
    w.log.warn('kept');
    expect(w.parsed().map((l) => l.msg)).toEqual(['kept']);
    const d = setup('debug');
    d.log.debug('kept');
    expect(d.lines).toHaveLength(1);
  });

  it('ignores an unknown level name (falls back to info)', () => {
    const s = setup('loud');
    s.log.debug('dropped');
    s.log.info('kept');
    expect(s.parsed().map((l) => l.msg)).toEqual(['kept']);
  });
});

describe('installProcessHandlers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs an unhandled rejection (redacted) instead of crashing, and installs once', () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l), now: () => 0 });
    // the node adapter's own listener, which logs the raw request URL (query included) and the raw reason
    const adapters = () => undefined;
    const handlers = new Map<string, ((...a: unknown[]) => void)[]>([['unhandledRejection', [adapters]]]);
    const proc = {
      on: (ev: string, fn: (...a: unknown[]) => void) => handlers.set(ev, [...(handlers.get(ev) ?? []), fn]),
      removeAllListeners: (ev: string) => handlers.delete(ev),
    };
    const flags = {};
    installProcessHandlers(log, proc, flags);
    installProcessHandlers(log, proc, flags);
    expect(handlers.get('unhandledRejection')).toHaveLength(1);
    expect(handlers.get('unhandledRejection')![0]).not.toBe(adapters);
    handlers.get('unhandledRejection')![0](new Error('fetch ?consumer_key=ck_9 failed'));
    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe('error');
    expect(entry.msg).toBe('unhandled rejection');
    expect(entry.err).toBe('Error: fetch ?consumer_key=[redacted] failed');
  });
});
