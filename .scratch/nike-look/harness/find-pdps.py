# Finds sample PDPs on a LOCAL storefront: sale products and multi-image galleries (GET only).
import re, sys, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:10026'
assert re.match(r'^http://(127\.0\.0\.1|localhost)(:\d+)?$', BASE), 'local only'

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return r.read().decode('utf8', 'replace')

seen = set()
for listing in sys.argv[2:] or ['/voruflokkur/sale/']:
    html = get(listing)
    links = [h for h in re.findall(r'href="(/verslun/[^"]+/)"', html) if h.count('/') >= 4]
    for h in links:
        if h in seen:
            continue
        seen.add(h)
        if len(seen) > 40:
            break
        try:
            p = get(h)
        except Exception as e:
            print('ERR', h, e)
            continue
        imgs = p.count('class="pdp-gallery__item"')
        badge = re.search(r'class="pdp-badge"[^>]*>([^<]+)<', p)
        variable = 'pdp-swatch' in p
        print(f'{imgs:2d} imgs  badge={badge.group(1) if badge else "-":5s} var={variable!s:5s} {h}')
