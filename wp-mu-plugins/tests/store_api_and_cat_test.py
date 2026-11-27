"""Behavioural test for the Store API `mos_and_cat` extension (an extra AND'ed product_cat clause).

fatnadur = 654 (hierarchical parent), konur = 2618, born = 2620. Expectation: products in fatnadur (incl.
children) AND in (konur OR born) — strictly fewer than fatnadur alone, > 0, and the collection-data
brand counts must shrink accordingly.
"""
import json, sys, urllib.request

B = 'http://127.0.0.1:10025/wp-json/wc/store/v1'


def total(q):
    with urllib.request.urlopen(f'{B}/products?per_page=1&{q}', timeout=30) as r:
        return int(r.headers.get('X-WP-Total'))


def brand_counts(q):
    with urllib.request.urlopen(f'{B}/products/collection-data?calculate_taxonomy_counts[0]=product_brand&{q}', timeout=60) as r:
        return {c['term']: c['count'] for c in json.load(r)['taxonomy_counts'] or []}


clothing = total('category=654')
clothing_womens = total('category=654&mos_and_cat=2618')
clothing_womens_or_kids = total('category=654&mos_and_cat=2618,2620')
womens = total('category=2618')
ok = True


def check(name, cond, detail):
    global ok
    ok &= cond
    print(('PASS' if cond else 'FAIL'), name, detail)


check('AND narrows the parent', 0 < clothing_womens < clothing, f'fatnadur={clothing} fatnadur∩konur={clothing_womens}')
check('AND is bounded by konur', clothing_womens <= womens, f'konur={womens}')
check('OR within the extra clause', clothing_womens < clothing_womens_or_kids <= clothing, f'fatnadur∩(konur∪born)={clothing_womens_or_kids}')
b_all = brand_counts('category=654')
brands_womens = brand_counts('category=654&mos_and_cat=2618')
check('brand counts follow the extra clause', sum(brands_womens.values()) < sum(b_all.values()),
      f'brand total fatnadur={sum(b_all.values())} fatnadur∩konur={sum(brands_womens.values())}')
sys.exit(0 if ok else 1)
