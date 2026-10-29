"""List CSS class selectors in src/styles/global.css that never appear in src/ outside the stylesheet.

Prints each unmatched class with the stylesheet line numbers that mention it. Run from the worktree root.
"""
import pathlib
import re
import sys

root = pathlib.Path("src")
css_path = root / "styles" / "global.css"
css = css_path.read_text()
# strip comments and url(...) payloads so their text isn't read as selectors
clean = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), css, flags=re.S)
clean = re.sub(r"url\([^)]*\)", "url()", clean)

classes: dict[str, list[int]] = {}
for lineno, line in enumerate(clean.splitlines(), 1):
    # only the selector part of the line (before "{"), or whole line when it's a selector continuation
    sel = line.split("{")[0]
    for m in re.finditer(r"\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)", sel):
        name = m.group(1)
        # skip numeric-ish matches like 0.5 / decimals
        if re.fullmatch(r"\d.*", name):
            continue
        classes.setdefault(name, []).append(lineno)

corpus = []
for p in root.rglob("*"):
    if p.is_file() and p != css_path and p.suffix in {".astro", ".ts", ".tsx", ".js", ".mjs", ".css", ".html"}:
        corpus.append(p.read_text())
text = "\n".join(corpus)

extra = sys.argv[1:]  # optional extra corpora (scripts etc.)
for e in extra:
    for p in pathlib.Path(e).rglob("*"):
        if p.is_file() and p.suffix in {".py", ".mjs", ".js", ".ts", ".php"}:
            text += "\n" + p.read_text(errors="ignore")

for name in sorted(classes):
    if re.search(r"(?<![-_a-zA-Z0-9])" + re.escape(name) + r"(?![-_a-zA-Z0-9])", text):
        continue
    # BEM-built names like `${base}__x` or `form-row-${w}`: check the prefix before a dynamic part
    print(f"{name}\t{sorted(set(classes[name]))}")
