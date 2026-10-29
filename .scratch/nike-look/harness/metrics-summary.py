"""Summarise shots/<set>/metrics.json: overflow, contrast failures and small phone tap targets per page.
usage: python3 metrics-summary.py <set>"""
import json, sys
from pathlib import Path

m = json.loads((Path(__file__).parent / "shots" / sys.argv[1] / "metrics.json").read_text())
for key in sorted(m):
    v = m[key]
    st = v.get("smallTargets") or {}
    print(f"{key:24} http {v.get('http')} overflowX {v.get('overflowX')} contrastFail {v['contrast']['failing']}/{v['contrast']['checked']} smallTargets {st.get('count', '-')}")
    for w in v["contrast"]["worst"][:4]:
        print(f"    contrast {w['ratio']} < {w['need']}  {w['el']}  {w['text']!r}")
    for s in (st.get("sample") or [])[:6]:
        print(f"    target {s}")
    for o in v.get("offenders", [])[:3]:
        print(f"    offender {o}")
