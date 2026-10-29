"""Behavioural test for mos-size-index.php: the Store API `mos_size` filter, `mos_size_counts` and mos/v1/sizes.

Needs the local site on :10025 with the index built (`wp mos-size reindex`). Skór = 653, Konur = 2618,
brand nike, pa_kyn kona. Expectations: a size narrows a listing and ORs within itself; counts leave the
size filter out (so they are the same with or without it) and agree with X-WP-Total; it combines with
brand, mos_and_cat and attributes[]; Woo's own counts (brand taxonomy counts) follow the size filter
instead of being served from the unfiltered cache; an unknown size matches nothing.
"""
import json, sys, urllib.request

W = 'http://127.0.0.1:10025/wp-json'
B = f'{W}/wc/store/v1'
SKOR, KONUR = 653, 2618
ok = True


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.headers, json.load(r)


def total(q):
    return int(get(f'{B}/products?per_page=1&{q}')[0].get('X-WP-Total'))


def size_counts(q):
    return {c['slug']: c for c in get(f'{B}/products/collection-data?mos_size_counts=1&{q}')[1]['mos_size_counts']}


def brand_total(q):
    data = get(f'{B}/products/collection-data?calculate_taxonomy_counts[0]=product_brand&{q}')[1]
    return sum(c['count'] for c in data['taxonomy_counts'] or [])


def check(name, cond, detail):
    global ok
    ok &= bool(cond)
    print(('PASS' if cond else 'FAIL'), name, detail)


skor = total(f'category={SKOR}')
s42 = total(f'category={SKOR}&mos_size=42')
s43 = total(f'category={SKOR}&mos_size=43')
s42_43 = total(f'category={SKOR}&mos_size=42,43')
check('size narrows the listing', 0 < s42 < skor, f'skor={skor} skor∩42={s42}')
check('OR within sizes', max(s42, s43) <= s42_43 <= s42 + s43, f'42={s42} 43={s43} 42∪43={s42_43}')
check('unknown size matches nothing', total(f'category={SKOR}&mos_size=no-such-size') == 0, '')

counts = size_counts(f'category={SKOR}')
check('counts agree with X-WP-Total', counts.get('42', {}).get('count') == s42 and counts.get('43', {}).get('count') == s43,
      f"count(42)={counts.get('42', {}).get('count')} count(43)={counts.get('43', {}).get('count')}")
first = next(iter(counts.values()))
check('count item shape', set(first) == {'slug', 'label', 'group', 'sort', 'count'}, json.dumps(first, ensure_ascii=False))
check('shoe sizes listed first', first['group'] == 'shoe', first['group'])
with_size = size_counts(f'category={SKOR}&mos_size=42')
check('counts leave the size filter out', {k: v['count'] for k, v in with_size.items()} == {k: v['count'] for k, v in counts.items()},
      f'{len(with_size)} vs {len(counts)} sizes')
check('a selected size with no products stays listed', size_counts(f'category={SKOR}&mos_size=176').get('176', {}).get('count') == 0, '')

nike = total(f'category={SKOR}&brand=nike')
nike42 = total(f'category={SKOR}&brand=nike&mos_size=42')
check('combines with brand', 0 < nike42 < min(nike, s42), f'nike={nike} nike∩42={nike42}')
check('counts follow brand', size_counts(f'category={SKOR}&brand=nike').get('42', {}).get('count') == nike42, '')
konur = total(f'category={SKOR}&mos_and_cat={KONUR}')
konur42 = total(f'category={SKOR}&mos_and_cat={KONUR}&mos_size=42')
check('combines with mos_and_cat', 0 < konur42 < min(konur, s42), f'skor∩konur={konur} ∩42={konur42}')
check('counts follow mos_and_cat', size_counts(f'category={SKOR}&mos_and_cat={KONUR}').get('42', {}).get('count') == konur42, '')
attr = 'attributes[0][attribute]=pa_kyn&attributes[0][slug][0]=kona&attributes[0][operator]=in'
kona = total(f'category={SKOR}&{attr}')
kona42 = total(f'category={SKOR}&{attr}&mos_size=42')
check('combines with attributes[]', 0 < kona42 < min(kona, s42), f'kona={kona} kona∩42={kona42}')
check("Woo's brand counts follow the size filter", brand_total(f'category={SKOR}&mos_size=42') < brand_total(f'category={SKOR}'), '')

# Woo's own counts with the size filter on, each first requested unfiltered so a cache leak would show.
NIKE, KONA = 547, 625
cd = f'{B}/products/collection-data'
get(f'{cd}?calculate_taxonomy_counts[0]=product_brand&category={SKOR}&mos_and_cat={KONUR}')
both = {c['term']: c['count'] for c in get(f'{cd}?calculate_taxonomy_counts[0]=product_brand&category={SKOR}&mos_and_cat={KONUR}&mos_size=42')[1]['taxonomy_counts']}
both_total = total(f'category={SKOR}&mos_and_cat={KONUR}&mos_size=42&brand=nike')
check('brand counts with mos_and_cat AND mos_size', both.get(NIKE) == both_total, f'count(nike)={both.get(NIKE)} listing={both_total}')
get(f'{cd}?calculate_stock_status_counts=1&category={SKOR}')
# Woo returns stock counts as strings.
stock = {c['status']: int(c['count']) for c in get(f'{cd}?calculate_stock_status_counts=1&category={SKOR}&mos_size=42')[1]['stock_status_counts']}
check('stock counts follow the size filter', sum(stock.values()) == s42, f'{stock} vs listing {s42}')
aq = 'calculate_attribute_counts[0][taxonomy]=pa_kyn&calculate_attribute_counts[0][query_type]=or'
get(f'{cd}?{aq}&category={SKOR}')
attr_counts = {c['term']: c['count'] for c in get(f'{cd}?{aq}&category={SKOR}&mos_size=42')[1]['attribute_counts']}
check('attribute counts follow the size filter', attr_counts.get(KONA) == kona42, f'count(kona)={attr_counts.get(KONA)} listing={kona42}')
zero = size_counts('').get('0', {}).get('count')
check('size slug "0" filters like any other', zero and total('mos_size=0') == zero, f'count(0)={zero} listing={total("mos_size=0")}')

sizes = get(f'{W}/mos/v1/sizes')[1]['sizes']
check('mos/v1/sizes lists every size with products', len(sizes) > 100 and all(s['count'] > 0 for s in sizes) and sizes[0]['group'] == 'shoe',
      f'{len(sizes)} sizes, first {sizes[0]["label"]}')
sys.exit(0 if ok else 1)
