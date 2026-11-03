// normaliseInstagram: the one boundary for mos/v1/instagram (mos-instagram.php). Whatever arrives, the home page gets
// a list it can render without throwing: posts only with an Instagram post link and an http(s) picture; anything
// else is dropped, and a missing or broken answer is "no posts" (the follow banner).
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { normaliseInstagram } = await import('./instagram');
const { INSTAGRAM_HANDLE, INSTAGRAM_URL } = await import('./site');

const post = (over: Record<string, unknown> = {}) => ({
  id: '1790',
  href: 'https://www.instagram.com/p/DfPHivOjHad/',
  caption: 'Ný sending',
  image: { url: 'http://localhost:10025/wp-content/uploads/mos-instagram/1790.jpg', width: 640, height: 640, alt: 'Ný sending' },
  ...over,
});

describe('normaliseInstagram', () => {
  it('keeps a well-formed post, its picture URL as WordPress sent it', () => {
    expect(normaliseInstagram({ handle: 'musikogsport', posts: [post()] }).posts).toEqual([
      {
        id: '1790',
        href: 'https://www.instagram.com/p/DfPHivOjHad/',
        caption: 'Ný sending',
        image: { url: 'http://localhost:10025/wp-content/uploads/mos-instagram/1790.jpg', width: 640, height: 640, alt: 'Ný sending' },
      },
    ]);
  });

  it('keeps reels and the tv form', () => {
    const posts = normaliseInstagram({
      posts: [post({ id: '1', href: 'https://www.instagram.com/reel/DfPEm6XsuvX/' }), post({ id: '2', href: 'https://www.instagram.com/tv/Abc_-1' })],
    }).posts;
    expect(posts.map((p) => p.id)).toEqual(['1', '2']);
  });

  it.each([
    ['a foreign link', { href: 'https://evil.example/p/x/' }],
    ['a look-alike host', { href: 'https://www.instagram.com.evil.example/p/x/' }],
    ['a javascript: link', { href: 'javascript:alert(1)' }],
    ['the profile, not a post', { href: 'https://www.instagram.com/musikogsport/' }],
    ['no picture', { image: null }],
    ['a data: picture', { image: { url: 'data:image/png;base64,AAAA', width: 1, height: 1, alt: '' } }],
    ['a relative picture', { image: { url: '/x.jpg', width: 1, height: 1, alt: '' } }],
    ['no id', { id: '' }],
  ])('drops a post with %s', (_label, over) => {
    expect(normaliseInstagram({ posts: [post(over)] }).posts).toEqual([]);
  });

  it('defaults missing text and sizes, and gives every picture an alt', () => {
    const [p] = normaliseInstagram({ posts: [{ id: '5', href: 'https://www.instagram.com/p/X/', image: { url: 'https://wp.example/x.jpg' } }] }).posts;
    expect(p).toEqual({ id: '5', href: 'https://www.instagram.com/p/X/', caption: '', image: { url: 'https://wp.example/x.jpg', width: 0, height: 0, alt: 'Mynd af Instagram' } });
  });

  it('keeps at most 12 posts, once each', () => {
    const many = Array.from({ length: 20 }, (_, i) => post({ id: String(i) }));
    expect(normaliseInstagram({ posts: [...many, post({ id: '0' })] }).posts.map((p) => p.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i)),
    );
  });

  it.each([null, undefined, 'x', 5, [], { posts: 'x' }, { posts: [null, 3, 'y', []] }])('turns %j into no posts', (raw) => {
    expect(normaliseInstagram(raw).posts).toEqual([]);
  });
});

describe('site constants', () => {
  it('names the store’s Instagram once', () => {
    expect(INSTAGRAM_HANDLE).toBe('musikogsport');
    expect(INSTAGRAM_URL).toBe('https://www.instagram.com/musikogsport/');
  });
});
