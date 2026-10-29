# Area 03: which image fields the LOCAL WC REST v3 product exposes (prints field names only, never the keys).
# usage (from the worktree root): python3 .scratch/nike-look/harness/rest-image-fields.py <slug>
import json
import sys
import urllib.parse
import urllib.request

env = {}
for line in open('.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k] = v.strip().strip('"')
base = env['WP_INTERNAL_URL']
assert base.startswith('http://127.0.0.1') or base.startswith('http://localhost'), 'local only'
q = urllib.parse.urlencode({
    'slug': sys.argv[1], 'status': 'publish',
    'consumer_key': env['WOOCOMMERCE_CONSUMER_KEY'], 'consumer_secret': env['WOOCOMMERCE_CONSUMER_SECRET'],
})
with urllib.request.urlopen(f'{base}/wp-json/wc/v3/products?{q}', timeout=15) as r:
    data = json.load(r)
p = data[0]
print('id', p['id'], 'type', p['type'], 'images', len(p['images']))
print('image keys', sorted(p['images'][0].keys()) if p['images'] else [])
print('brands', [b.get('name') for b in p.get('brands', [])])
print('categories', [c.get('name') for c in p.get('categories', [])])
print('on_sale', p.get('on_sale'), 'price_html', p.get('price_html', '')[:200])
print('desc chars', len(p.get('description') or ''), 'short chars', len(p.get('short_description') or ''))
