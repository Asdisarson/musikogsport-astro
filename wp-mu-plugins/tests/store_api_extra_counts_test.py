"""Behavioural test for `mos_extra_counts` in mos-size-index.php: the price-range and sale counts that one
collection-data request now returns must equal what one request per count gave before (the storefront's old path:
collection-data with calculate_stock_status_counts, summed over every status or only the ones the query is
limited to).

Needs the local site on :10025 with the index built. Skór = 653, Fatnaður = 654, Konur = 2618, brand nike.
Run: python3 wp-mu-plugins/tests/store_api_extra_counts_test.py   (exit code 0 = all pass)
"""
import json, sys, urllib.parse, urllib.request

B = 'http://127.0.0.1:10025/wp-json/wc/store/v1'
CD = f'{B}/products/collection-data'
RANGES = [(None, 4999), (5000, 9999), (10000, 19999), (20000, None)]  # the storefront's presets, ISK (minor unit 0)
CONTEXTS = [
    ('Skór', 'category=653'),
    ('Skór, Konur, Nike', 'category=653&mos_and_cat=2618&brand=nike'),
    ('Skór, size 42', 'category=653&mos_size=42'),
    ('Skór, in stock only', 'category=653&stock_status[]=instock'),
    ('Fatnaður, on sale, 5.000-10.000', 'category=654&on_sale=true&min_price=5000&max_price=9999'),
]
ok = True


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def check(name, cond, detail=''):
    global ok
    ok &= bool(cond)
    print(('PASS' if cond else 'FAIL'), name, detail)


def without_price(q):
    return '&'.join(p for p in q.split('&') if not p.startswith(('min_price=', 'max_price=')))


def old_count(q):
    """One request: the products matching q, from its stock-status counts (only the statuses q is limited to)."""
    only = [urllib.parse.unquote(p.split('=', 1)[1]) for p in q.split('&') if p.startswith('stock_status[]=')]
    rows = get(f'{CD}?calculate_stock_status_counts=true&{q}')['stock_status_counts'] or []
    return sum(int(r['count']) for r in rows if not only or r['status'] in only)


def bound(v):
    return '' if v is None else str(v)


ranges_param = ','.join(f'{bound(a)}:{bound(b)}' for a, b in RANGES)
for name, q in CONTEXTS:
    extra = get(f'{CD}?mos_extra_counts=1&mos_price_ranges={urllib.parse.quote(ranges_param)}&mos_sale_count=1&{q}').get('mos_extra_counts')
    check(f'{name}: field present', isinstance(extra, dict) and len(extra.get('price') or []) == len(RANGES), json.dumps(extra))
    if not isinstance(extra, dict):
        continue
    old_prices = []
    for lo, hi in RANGES:
        p = without_price(q) + (f'&min_price={lo}' if lo is not None else '') + (f'&max_price={hi}' if hi is not None else '')
        old_prices.append(old_count(p))
    old_sale = old_count(q if 'on_sale=true' in q else f'{q}&on_sale=true')
    check(f'{name}: price counts match one request each', extra['price'] == old_prices, f"new={extra['price']} old={old_prices}")
    check(f'{name}: sale count matches', extra['on_sale'] == old_sale, f"new={extra['on_sale']} old={old_sale}")

# Composes with the size counts in the same request, and leaves the rest of the response alone.
both = get(f'{CD}?mos_size_counts=1&mos_extra_counts=1&mos_price_ranges=:4999&calculate_stock_status_counts=true&category=653&mos_size=42')
check('size counts and extra counts together', isinstance(both.get('mos_size_counts'), list) and both['mos_size_counts'] and both['mos_extra_counts']['price'][0] is not None,
      f"{len(both.get('mos_size_counts') or [])} sizes, price {both.get('mos_extra_counts')}")
plain = get(f'{CD}?calculate_stock_status_counts=true&category=653')
check('no field unless asked for', 'mos_extra_counts' not in plain and 'mos_size_counts' not in plain, '')
check('no sale count unless asked for', get(f'{CD}?mos_extra_counts=1&mos_price_ranges=:4999&category=653')['mos_extra_counts']['on_sale'] is None, '')
check('junk ranges are ignored', get(f'{CD}?mos_extra_counts=1&mos_price_ranges=x:y,9:1&category=653')['mos_extra_counts']['price'] == [], '')
sys.exit(0 if ok else 1)
