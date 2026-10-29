"""Integration sweep (ticket 10): crawl every link on the homepage (menus, side menu, banners, footer)
plus a sample of sitemap URLs on the storefront (Local's :10026 by default, or STOREFRONT_URL). Follows
one 301. Everything must end
at 200, except categories that only exist on live (the local data is the May dump — decision 2).
Also checks that every JSON-LD block on a few key pages parses.

Usage: python3 scripts/crawl_links.py [--sitemap-sample N]
"""
import html
import json
import os
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get('STOREFRONT_URL', 'http://127.0.0.1:10026').rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


opener = urllib.request.build_opener(NoRedirect)


def fetch(path):
    try:
        with opener.open(BASE + path, timeout=60) as r:
            return r.status, '', r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Location', ''), e.read().decode('utf-8', 'ignore')


def resolve(path):
    """Status after at most one redirect, plus the redirect target if any."""
    s, loc, body = fetch(path)
    if s in (301, 302, 303, 307, 308) and loc:
        target = urllib.parse.urlsplit(urllib.parse.urljoin(BASE + path, loc))
        if target.netloc and target.netloc != urllib.parse.urlsplit(BASE).netloc:
            return s, loc, 'external'
        nxt = target.path + (('?' + target.query) if target.query else '')
        s2, _, body2 = fetch(nxt)
        return s2, nxt, body2
    return s, '', body


def links(page_html):
    out = set()
    for href in re.findall(r'<a\b[^>]*\bhref="([^"]+)"', page_html):
        href = html.unescape(href)
        if href.startswith(('mailto:', 'tel:', '#', 'javascript:')):
            continue
        u = urllib.parse.urlsplit(href)
        if u.netloc and u.netloc != urllib.parse.urlsplit(BASE).netloc:
            continue  # off-site (absolute links to the storefront itself are followed)
        out.add(u.path + (('?' + u.query) if u.query else ''))
    return out


def jsonld_ok(page_html):
    blocks = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page_html, re.S)
    types = []
    for b in blocks:
        data = json.loads(b)  # raises on invalid JSON
        types.append(data.get('@type') if isinstance(data, dict) else 'list')
    return types


def main():
    sample = 60
    if '--sitemap-sample' in sys.argv:
        sample = int(sys.argv[sys.argv.index('--sitemap-sample') + 1])
    s, _, home = fetch('/')
    assert s == 200, f'home {s}'
    targets = sorted(links(home))
    s, _, sm = fetch('/sitemap.xml')
    locs = [urllib.parse.urlsplit(l).path for l in re.findall(r'<loc>([^<]+)</loc>', sm)]
    random.seed(12)
    sitemap_sample = random.sample(locs, min(sample, len(locs)))
    print(f'homepage links: {len(targets)}  sitemap URLs: {len(locs)} (sampling {len(sitemap_sample)})')

    bad, live_only, redirects = [], [], []
    for path in targets + [p for p in sitemap_sample if p not in targets]:
        status, via, _ = resolve(path)
        if via == 'external':
            continue
        if via:
            redirects.append((path, via))
        if status == 200:
            continue
        # a category / brand link from live's menu that the May data doesn't have
        if status == 404 and re.match(r'^/(voruflokkur|brand|merkimidar)/', path):
            live_only.append(path)
        else:
            bad.append((path, status, via))

    for path, via in redirects:
        print(f'  301 {path} -> {via}')
    print(f'live-only (404, expected — not in the May data): {len(live_only)}')
    for p in live_only:
        print(f'  {p}')
    for path, status, via in bad:
        print(f'FAIL {status} {path} {via}')

    for page in ['/', '/voruflokkur/skor/', '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/']:
        s, _, body = fetch(page)
        try:
            print(f'JSON-LD {page}: {jsonld_ok(body)}')
        except ValueError as e:
            bad.append((page, 'json-ld', str(e)))
            print(f'FAIL JSON-LD {page}: {e}')

    print('OK' if not bad else f'{len(bad)} failures')
    sys.exit(0 if not bad else 1)


if __name__ == '__main__':
    main()
