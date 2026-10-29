"""Run scripts/verify_content_pages.py (hard-wired to :4322) against the :4323 preview, unchanged otherwise.
usage (worktree root): python3 .scratch/nike-look/harness/content-pages-4323.py"""
from pathlib import Path

src = Path('scripts/verify_content_pages.py').read_text()
assert "B = 'http://127.0.0.1:4322'" in src
exec(compile(src.replace("B = 'http://127.0.0.1:4322'", "B = 'http://127.0.0.1:4323'"), 'verify_content_pages.py', 'exec'))
