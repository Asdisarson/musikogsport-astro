import { describe, expect, it } from 'vitest';
import { MAX_POKE_PATHS, parseShellPoke } from './shellPoke';

describe('parseShellPoke', () => {
  it('accepts stale and drop lists of storefront product or category paths, and the listings flag', () => {
    expect(parseShellPoke({ stale: ['/verslun/skor/vara-1/'], drop: ['/vara/golfsett/'], listings: true })).toEqual({
      stale: ['/verslun/skor/vara-1/'],
      drop: ['/vara/golfsett/'],
      listings: true,
      products: false,
    });
    expect(parseShellPoke({ listings: false })).toEqual({ stale: [], drop: [], listings: false, products: false });
  });

  it('accepts Icelandic letters in slugs', () => {
    expect(parseShellPoke({ stale: ['/verslun/íþróttir/þrúgu-æði/'] })?.stale).toEqual(['/verslun/íþróttir/þrúgu-æði/']);
  });

  it('refuses anything outside the storefront product and category paths', () => {
    const bad = [
      '/karfa/',
      '/api/cart',
      'https://evil.example/verslun/x/',
      '//evil.example/verslun/x/',
      '/verslun/../karfa/',
      '/verslun/x?y=1/',
      '/verslun/x',
      '/vara/a b/',
    ];
    for (const p of bad) expect(parseShellPoke({ stale: [p] }), p).toBeNull();
  });

  it('skips a path that is too long, and keeps the others of the same poke (review 6)', () => {
    const long = '/verslun/' + 'a'.repeat(250) + '/';
    expect(parseShellPoke({ stale: [long, '/vara/a/'], drop: [long] })).toEqual({ stale: ['/vara/a/'], drop: [], listings: false, products: false });
    expect(parseShellPoke({ stale: [long] })).toEqual({ stale: [], drop: [], listings: false, products: false });
  });

  it('refuses bodies that are not the expected shape or are too big', () => {
    expect(parseShellPoke(null)).toBeNull();
    expect(parseShellPoke('x')).toBeNull();
    expect(parseShellPoke({ stale: 'x' })).toBeNull();
    expect(parseShellPoke({ stale: [1] })).toBeNull();
    expect(parseShellPoke({ listings: 'yes' })).toBeNull();
    expect(parseShellPoke({ stale: Array.from({ length: MAX_POKE_PATHS + 1 }, (_, i) => `/vara/p${i}/`) })).toBeNull();
    expect(parseShellPoke({})).toEqual({ stale: [], drop: [], listings: false, products: false });
  });

  it('drops duplicates', () => {
    expect(parseShellPoke({ stale: ['/vara/a/', '/vara/a/'] })?.stale).toEqual(['/vara/a/']);
  });
});

import { createHash } from 'node:crypto';
import { pokeKeyMatches, readCappedBody, MAX_POKE_BYTES } from './shellPoke';

describe('shell poke: the products flag, the body cap and the optional key (review 4, 8, 9, 20)', () => {
  it('accepts the products flag and refuses a non-boolean one', () => {
    expect(parseShellPoke({ products: true })).toEqual({ stale: [], drop: [], listings: false, products: true });
    expect(parseShellPoke({ products: 'yes' })).toBeNull();
  });

  it('reads a small body, and refuses one that is too big before reading it (by its length)', async () => {
    expect(await readCappedBody(new Request('http://x/', { method: 'POST', body: '{"listings":true}' }))).toBe('{"listings":true}');
    const big = 'x'.repeat(MAX_POKE_BYTES + 1);
    expect(await readCappedBody(new Request('http://x/', { method: 'POST', body: big }))).toBeNull();
  });

  it('cuts off a streamed body (no length) at the cap', async () => {
    const chunk = new Uint8Array(4096).fill(120);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (this.n === undefined) this.n = 0;
        this.n += 1;
        if (this.n > 20) c.close();
        else c.enqueue(chunk);
      },
    } as UnderlyingDefaultSource<Uint8Array> & { n?: number });
    const req = new Request('http://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readCappedBody(req, 16 * 1024)).toBeNull();
  });

  it('matches the shared key only exactly', () => {
    const key = 'k-' + createHash('sha1').update('x').digest('hex');
    expect(pokeKeyMatches(key, key)).toBe(true);
    expect(pokeKeyMatches(key + 'x', key)).toBe(false);
    expect(pokeKeyMatches(null, key)).toBe(false);
  });
});
