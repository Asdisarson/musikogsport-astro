"""Store API check for the Félag/Lið (team) facet of mos-catalog-clean.php: the count the filter shows next to a team
equals the number of products the listing returns for it, and the team group combines with the other groups the way
the storefront asks (AND across groups, OR within one group).

Run against a WordPress where `wp mos-clean apply` has run:
    python3 wp-mu-plugins/tests/store_api_team_test.py [base-url]   (exit code 0 = pass)

Nothing is hard-coded to this clone's ids or to a team slug: the teams come from the attribute's own terms, and the
reference product is looked up by its slug (SKIPped with a message if this catalog does not have it). So the test
passes before the hsi -> island-iceland merge and after it, without edits.
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:10025").rstrip("/") + "/wp-json/wc/store/v1"
TEAM = "pa_felag-lid"
SPORT = "pa_ithrott"
REF_SLUG = "hsi-kk-treyja-2025"  # HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ
GENDER_SLUGS = {"karlar", "konur", "born"}  # the storefront's gender audiences (src/lib/sizeGuide.ts)

fail = 0


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return json.load(r), r.headers


def listing_total(query):
    _, h = get(f"/products?per_page=1&{query}")
    return int(h["X-WP-Total"])


def listing_ids(query):
    ids, page = [], 1
    while True:
        data, h = get(f"/products?per_page=100&page={page}&{query}")
        ids += [p["id"] for p in data]
        if page >= int(h.get("X-WP-TotalPages", 1)) or not data:
            return ids
        page += 1


def term_query(taxonomy, term_ids, index=0):
    q = f"attributes[{index}][attribute]={taxonomy}"
    q += "".join(f"&attributes[{index}][term_id][]={t}" for t in term_ids)
    return q


def all_terms(attribute_id):
    out, page = [], 1
    while True:
        data, h = get(f"/products/attributes/{attribute_id}/terms?per_page=100&page={page}")
        out += data
        if page >= int(h.get("X-WP-TotalPages", 1)) or not data:
            return out
        page += 1


skipped = 0


def skip(message):
    """A check that could not run on this catalog. It is counted: a run with skips is not a clean pass."""
    global skipped
    skipped += 1
    print("SKIP " + message)


def check(ok, message):
    global fail
    if not ok:
        fail += 1
    print(("PASS " if ok else "FAIL ") + message)


attrs, _ = get("/products/attributes")
attribute = {a["taxonomy"]: a["id"] for a in attrs}
if TEAM not in attribute:
    print(f"FAIL no {TEAM} attribute on this site")
    sys.exit(1)

# 1. Every team term with products: collection-data count == listing X-WP-Total.
teams = [t for t in all_terms(attribute[TEAM]) if t.get("count", 0) > 0]
counts_data, _ = get(
    "/products/collection-data?calculate_attribute_counts[0][taxonomy]=" + TEAM
    + "&calculate_attribute_counts[0][query_type]=or"
)
facet = {c["term"]: c["count"] for c in counts_data.get("attribute_counts") or []}
print(f"{len(teams)} team terms with products, {len(facet)} counted by collection-data")
check(len(teams) > 0, "at least one team term carries products")
for t in teams:
    shown = facet.get(t["id"])
    listed = listing_total(term_query(TEAM, [t["id"]]))
    check(shown == listed, f"team {t['slug']} (id {t['id']}): facet shows {shown}, listing returns {listed}")

# 2. Combined filters: the reference product is found by all its own groups together.
ref, _ = get(f"/products?per_page=1&slug={REF_SLUG}")
if not ref:
    skip(f"reference product {REF_SLUG} is not in this catalog: combined-filter check not run")
else:
    p = ref[0]
    team_ids = [term["id"] for a in p["attributes"] if a.get("taxonomy") == TEAM for term in a["terms"]]
    sport_ids = [term["id"] for a in p["attributes"] if a.get("taxonomy") == SPORT for term in a["terms"]]
    brand_ids = [b["id"] for b in p.get("brands", [])]
    gender_ids = [c["id"] for c in p["categories"] if c["slug"] in GENDER_SLUGS]
    print(f"reference {p['name']}: team {team_ids}, sport {sport_ids}, brand {brand_ids}, kyn {gender_ids}")
    if not (team_ids and sport_ids and brand_ids and gender_ids):
        skip("the reference product lacks a team, sport, brand or Kyn category: combined-filter check not run")
    else:
        combined = [
            term_query(TEAM, team_ids),
            term_query(SPORT, sport_ids, index=1),
            "attribute_relation=and",
            "brand=" + ",".join(map(str, brand_ids)),
            "mos_and_cat=" + ",".join(map(str, gender_ids)),
        ]
        check(p["id"] in listing_ids("&".join(combined)), "all groups together contain the reference product")
        other = [t["id"] for t in teams if t["id"] not in team_ids]
        if other:
            # Only a team it does not carry (team facet replaced, every other group kept): it must drop out.
            swapped = [term_query(TEAM, other[:1]), term_query(SPORT, sport_ids, index=1), "attribute_relation=and",
                       "brand=" + ",".join(map(str, brand_ids)), "mos_and_cat=" + ",".join(map(str, gender_ids))]
            check(p["id"] not in listing_ids("&".join(swapped)), "a team it does not carry excludes it")
        else:
            skip("no second team with products: exclusion check not run")

# 3. Two teams in one group are an OR.
if len(teams) >= 2:
    a, b = teams[0]["id"], teams[1]["id"]
    ta, tb = listing_total(term_query(TEAM, [a])), listing_total(term_query(TEAM, [b]))
    # Exactly the products of either team: a server that honoured only one of the two terms would still fit a loose
    # "between the larger and the sum" bound.
    either = set(listing_ids(term_query(TEAM, [a]))) | set(listing_ids(term_query(TEAM, [b])))
    both = set(listing_ids(term_query(TEAM, [a, b])))
    check(both == either, f"teams {a} or {b}: {ta} | {tb} -> {len(both)} products, the two teams' own products together are {len(either)}")
else:
    skip("fewer than two teams with products: OR check not run")

print(f"{fail} failed" if fail else ("PASS" if skipped == 0 else f"PASS, but {skipped} check(s) did not run: see the SKIP lines"))
sys.exit(0 if fail == 0 else 1)
