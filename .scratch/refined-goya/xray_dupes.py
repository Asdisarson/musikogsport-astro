"""Selectors that appear as more than one single-line rule inside the same @media block of global.css.
Run from the worktree root."""
import pathlib
import re
from collections import defaultdict

lines = pathlib.Path("src/styles/global.css").read_text().splitlines()
ctx = ["top"]
depth_stack = []
seen = defaultdict(list)
depth = 0
for n, line in enumerate(lines, 1):
    s = line.strip()
    m = re.match(r"(@media[^{]*)\{\s*$", s)
    if m:
        depth_stack.append((depth, m.group(1).strip()))
        depth += 1
        continue
    m = re.match(r"([^{}@/][^{}]*)\{.*\}\s*(/\*.*\*/)?\s*$", s)
    if m:
        media = depth_stack[-1][1] if depth_stack else "-"
        seen[(media, m.group(1).strip())].append(n)
    depth += s.count("{") - s.count("}")
    while depth_stack and depth <= depth_stack[-1][0]:
        depth_stack.pop()

for (media, sel), ns in sorted(seen.items(), key=lambda kv: kv[1][0]):
    if len(ns) > 1:
        print(f"{ns}\t{media}\t{sel}")
