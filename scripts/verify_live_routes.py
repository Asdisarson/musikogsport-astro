"""Runtime checks for ticket 03 (live URL routing) against the storefront: Local's :10026 by default, or
STOREFRONT_URL (e.g. http://127.0.0.1:4322 for a dev server started from a worktree)."""
import os, re, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get('STOREFRONT_URL', 'http://127.0.0.1:10026').rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


opener = urllib.request.build_opener(NoRedirect)


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={'Accept': 'text/html'})
    try:
        r = opener.open(req, timeout=60)
        return r.status, r.headers.get('Location'), r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Location'), e.read().decode('utf-8', 'ignore')


for _ in range(60):
    try:
        fetch('/verslun/')
        break
    except Exception:
        time.sleep(2)
else:
    print(f'FAIL storefront not reachable at {BASE} after 2 minutes')
    sys.exit(1)

ok = True


def check(name, cond, detail=''):
    global ok
    ok &= bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def products_on(html):
    hrefs = re.findall(r'class="product-card__title"[^>]*>\s*<a href="([^"]+)"', html)
    return hrefs


def count_text(html):
    # live hides WooCommerce's result count; the clone keeps it as a visually hidden status line
    m = re.search(r'role="status"[^>]*>([^<]+)<', html)
    return m.group(1).strip() if m else ''


s, loc, html = fetch('/verslun/')
p1 = products_on(html)
check('shop page 1 renders 24 products', s == 200 and len(p1) == 24, f'{s} n={len(p1)} "{count_text(html)}"')
check('product links use live /verslun/<cat>/<slug>/ shape', all(h.startswith('/verslun/') and h.endswith('/') and h.count('/') >= 4 for h in p1), p1[0] if p1 else '')

s, loc, html2 = fetch('/verslun/page/2/')
p2 = products_on(html2)
check('shop page 2 renders a distinct grid', s == 200 and len(p2) == 24 and not set(p1) & set(p2), f'{s} overlap={len(set(p1) & set(p2))}')
s, loc, _ = fetch('/verslun/page/1/')
check('/verslun/page/1/ 301s to /verslun/', s == 301 and loc == '/verslun/', f'{s} {loc}')

s, loc, html = fetch('/voruflokkur/skor/')
check('category archive renders', s == 200 and len(products_on(html)) > 0, f'{s} "{count_text(html)}"')
s, loc, html = fetch('/voruflokkur/skor/page/2/')
check('category page 2 renders', s == 200 and len(products_on(html)) > 0, f'{s}')
s, loc, _ = fetch('/voruflokkur/fotboltaskor-ithrottaskor/')
check('short category chain 301s to canonical', s == 301 and loc == '/voruflokkur/skor/ithrottaskor/fotboltaskor-ithrottaskor/', f'{s} {loc}')
s, loc, _ = fetch('/voruflokkur/thetta-er-ekki-til/')
check('unknown category 404s', s == 404, f'{s}')

s, loc, html_all = fetch('/voruflokkur/fatnadur/')
s2, loc2, html_k = fetch('/voruflokkur/fatnadur/?kyn=konur')
check('kyn filter narrows a category archive', s2 == 200 and count_text(html_k) != count_text(html_all), f'"{count_text(html_all)}" -> "{count_text(html_k)}"')
check('kyn option is marked active', re.search(r'aria-checked="true"[^>]*>\s*<span class="filter-option__box"[^>]*></span>\s*<span class="filter-option__label"[^>]*>Konur', html_k) is not None)

s, loc, html = fetch('/verslun/?brand=casall')
check('brand filter on shop', s == 200 and len(products_on(html)) > 0, f'"{count_text(html)}"')
s, loc, html = fetch('/verslun/?orderby=price')
check('price sort accepted (selected in dropdown)', s == 200 and re.search(r'<option value="price"[^>]*selected', html) is not None)

s, loc, html = fetch('/brand/nike/')
check('brand archive renders', s == 200 and len(products_on(html)) > 0, f'"{count_text(html)}"')
s, loc, html = fetch('/merkimidar/worldcup/')
check('tag archive responds', s in (200, 404), f'{s}')

s, loc, html = fetch('/?s=nike&post_type=product')
check('search on the home URL renders results', s == 200 and 'Leitarniðurstöður' in html and len(products_on(html)) > 0, f'{s} "{count_text(html)}"')
s, loc, html = fetch('/page/2/?s=nike&post_type=product')
check('search page 2 renders', s == 200 and len(products_on(html)) > 0, f'{s}')
s, loc, _ = fetch('/leita?q=nike')
check('legacy /leita redirects to /?s=', s == 301 and loc and loc.startswith('/?s=nike'), f'{s} {loc}')

prod = p1[0] if p1 else '/'
s, loc, html = fetch(prod)
check('product page renders at its live URL', s == 200 and 'pdp' in html, f'{s} {prod}')
slug = prod.rstrip('/').split('/')[-1]
s, loc, _ = fetch(f'/verslun/{slug}/')
check('wrong product path 301s to the canonical one', s == 301 and loc == prod, f'{s} {loc}')
s, loc, _ = fetch(f'/vara/{slug}')
check('legacy /vara/<slug> 301s to the live product URL', s == 301 and loc == prod, f'{s} {loc}')
s, loc, _ = fetch('/verslun/sale/')
check('legacy one-segment /verslun/<category>/ 301s to /voruflokkur/', s == 301 and loc == '/voruflokkur/sale/', f'{s} {loc}')

s, loc, _ = fetch('/voruflokkur/skor')
check('slash-less page path 301s to the slashed one', s == 301 and loc == '/voruflokkur/skor/', f'{s} {loc}')
s, _, html = fetch('/karfa/')
check('cart page renders at /karfa/', s == 200 and 'Karfa' in html, f'{s}')
s, _, html = fetch('/gera-upp/')
check('checkout renders distraction-free at /gera-upp/', s == 200 and 'class="checkout-header' in html and '<footer' not in html, f'{s}')
s, _, html = fetch('/gera-upp/order-received/1/?key=wc_order_wrong')
# PA-06: a wrong key is a miss (404, neutral copy); only a verified order is confirmed as received
check('order-received with a wrong key shows no order details and no confirmation', s == 404 and 'Pöntunarnúmer' not in html and 'móttekin' not in html, f'{s}')
s, loc, _ = fetch('/utskra')
check('legacy /utskra 301s to /gera-upp/', s == 301 and loc == '/gera-upp/', f'{s} {loc}')
s, loc, _ = fetch('/utskra/takk?order_id=42&order_key=wc_order_abc')
check('legacy thank-you 301s to the order-received endpoint', s == 301 and loc == '/gera-upp/order-received/42/?key=wc_order_abc', f'{s} {loc}')

s, _, html = fetch('/min-sida/')
check('account page shows the login form (no register form)', s == 200 and 'action="/api/account/login"' in html and 'register' not in html.lower(), f'{s}')
s, loc, _ = fetch('/min-sida/orders/')
check('account sub-pages send signed-out visitors to the login', s in (302, 303) and loc == '/min-sida/', f'{s} {loc}')
s, loc, _ = fetch('/min-sida/view-order/1/')
check('view-order needs a session', s in (302, 303) and loc == '/min-sida/', f'{s} {loc}')

s, loc, body = fetch('/sitemap.xml')
check('sitemap has /voruflokkur/ and /verslun/<cat>/<slug>/ URLs', s == 200 and '/voruflokkur/' in body and re.search(r'/verslun/[^<]+/[^<]+/</loc>', body) is not None and '/vara/' not in body, f'{s} urls={body.count("<loc>")}')
s, loc, body = fetch('/api/healthz')
check('health check /api/healthz answers 200 ok, no redirect (App Platform)', s == 200 and body == 'ok' and loc is None, f'{s} {loc}')
sys.exit(0 if ok else 1)
