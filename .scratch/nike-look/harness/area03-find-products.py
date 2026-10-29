# Area 03: find probe products on the LOCAL Store API (no keys): colour-variable products whose variations carry
# their own images, simple in-stock products, sale products and 5+ image galleries.
# usage: python3 area03-find-products.py [pages]
import json
import sys
import urllib.request

BASE = 'http://127.0.0.1:10025/wp-json/wc/store/v1'


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.load(r)


pages = int(sys.argv[1]) if len(sys.argv) > 1 else 6
colour, simple, sale, gallery = [], [], [], []
for page in range(1, pages + 1):
    for p in get(f'/products?per_page=100&page={page}&orderby=date&order=desc'):
        path = p['permalink'].split('10025')[-1]
        attrs = p.get('attributes') or []
        if any(a['name'].lower().startswith('lit') and a.get('has_variations') for a in attrs):
            colour.append((p['id'], path, len(p['images']), len(p.get('variations') or [])))
        if p['type'] == 'simple' and p['is_in_stock'] and len(simple) < 5:
            simple.append((p['id'], path, len(p['images'])))
        if p['on_sale'] and p['type'] == 'simple' and len(sale) < 5:
            sale.append((p['id'], path, len(p['images'])))
        if len(p['images']) >= 5 and len(gallery) < 5:
            gallery.append((p['id'], path, len(p['images']), p['type']))
print('simple', simple)
print('sale(simple)', sale)
print('gallery5+', gallery)
print('colour-variable', len(colour))
for pid, path, nimg, nvar in colour[:12]:
    vars_ = get(f'/products/{pid}').get('variations') or []
    srcs = set()
    for v in vars_[:30]:
        vd = get(f"/products/{v['id']}")
        if vd.get('images'):
            srcs.add(vd['images'][0]['src'])
    print(pid, path, 'images', nimg, 'variations', nvar, 'distinct variation images', len(srcs))
