"""Custom properties defined in src/ but never read via var(), and var() reads with no definition.
Also lists class names in branch-touched markup that global.css never mentions. Run from the worktree root."""
import pathlib
import re

root = pathlib.Path("src")
files = [p for p in root.rglob("*") if p.is_file() and p.suffix in {".astro", ".ts", ".tsx", ".css"}]
text = "\n".join(p.read_text() for p in files)

defined = set(re.findall(r"(--[a-zA-Z][-a-zA-Z0-9]*)\s*:", text))
used = set(re.findall(r"var\(\s*(--[a-zA-Z][-a-zA-Z0-9]*)", text))
# style={{ '--x': ... }} / style="--x: ..." / setProperty('--x')
defined |= set(re.findall(r"['\"](--[a-zA-Z][-a-zA-Z0-9]*)['\"]", text))
print("defined, never read:", sorted(defined - used))
print("read, never defined:", sorted(used - defined))

css = (root / "styles" / "global.css").read_text()
markup = [p for p in root.rglob("*") if p.is_file() and p.suffix in {".astro", ".tsx"}]
missing = {}
for p in markup:
    for m in re.finditer(r"class(?:Name)?=\"([^\"]+)\"", p.read_text()):
        for c in m.group(1).split():
            if not re.search(r"\." + re.escape(c) + r"(?![-_a-zA-Z0-9])", css):
                missing.setdefault(c, set()).add(str(p))
print("markup classes with no CSS rule:")
for c in sorted(missing):
    print(" ", c, sorted(missing[c]))
