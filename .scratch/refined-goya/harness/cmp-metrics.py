# Compare two shot sets' metrics for chosen pages: overflow, contrast failures, small tap targets.
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
for key in sorted(set(a) | set(b)):
    if not any(key.startswith(p + '@') for p in sys.argv[3:]):
        continue
    def row(m):
        if not m: return '-'
        st = m.get('smallTargets') or {}
        return f"http={m.get('http')} ox={m.get('overflowX')} lowC={m['contrast']['failing']} small={st.get('count', '-')}"
    print(f'{key:22s} before[{row(a.get(key))}]  after[{row(b.get(key))}]')
    sm = (b.get(key) or {}).get('smallTargets') or {}
    for s in sm.get('sample', [])[:6]:
        print('      small:', s)
    for c in (b.get(key) or {}).get('contrast', {}).get('worst', [])[:4]:
        print('      lowC:', c)
