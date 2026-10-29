"""Store API check for mos-catalog-clean.php: the colour attribute (pa_litur) filters and counts agree.

Run against a WordPress where `wp mos-clean apply` has run:
    python3 wp-mu-plugins/tests/store_api_colour_test.py [base-url]   (exit code 0 = pass)
"""
import json
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:10025").rstrip("/") + "/wp-json/wc/store/v1"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.load(r), r.headers


def attribute_id(taxonomy):
    attrs, _ = get("/products/attributes")
    return next(a["id"] for a in attrs if a["taxonomy"] == taxonomy)


fail = 0
colour = attribute_id("pa_litur")
data, _ = get("/products/collection-data?calculate_attribute_counts[0][taxonomy]=pa_litur&calculate_attribute_counts[0][query_type]=or")
counts = sorted(((c["count"], c["term"]) for c in data["attribute_counts"]), reverse=True)
_, h = get("/products?per_page=1")
total = int(h["X-WP-Total"])
if len(counts) < 8:
    fail += 1
    print(f"FAIL only {len(counts)} colours carry products")
if counts and counts[0][0] < total * 0.05:
    fail += 1
    print(f"FAIL the commonest colour covers {counts[0][0]} of {total} products")
for count, term in counts[:6]:
    _, h = get(f"/products?per_page=1&attributes[0][attribute]=pa_litur&attributes[0][term_id][]={term}")
    listed = int(h["X-WP-Total"])
    if listed != count:
        fail += 1
        print(f"FAIL colour term {term}: count {count}, listing {listed}")
terms, _ = get(f"/products/attributes/{colour}/terms?per_page=100")
empty = [t["name"] for t in terms if t["count"] == 0]
print(f"{len(counts)} colours with products, top: {counts[:3]}; empty terms: {len(empty)}")
print("PASS" if fail == 0 else f"{fail} failed")
sys.exit(0 if fail == 0 else 1)
