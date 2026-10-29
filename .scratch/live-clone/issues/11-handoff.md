# 11 Handoff

Type: task
Status: resolved (2026-10-16); `/verify` is user-invoked and still to run
Blocked by: 10

## Question

Ask the user: check out `feat/live-clone` in the main app-astro checkout? Push the branches? Then restore the
dev shim to :10026 and confirm Local's :10026 serves the clone.

## Answer

The user's answers (2026-10-14):
- Switch the main checkout.
- Strip the trailers, then push.
- Keep the history as it is (no squash).

### Trailer strip

- **Scope:** the eight commits on `feat/storefront-makeover` that predate this effort carried
  `Co-Authored-By: Claude` trailers. Only commits no remote had were rewritten (`filter-branch --msg-filter
  … -- feat/storefront-makeover feat/live-clone --not --remotes`). That changed every hash on both branches.
- **Checks:**
  - every tree is byte-identical to its backup
  - commit counts were unchanged by the rewrite (70 and 36)
  - a long message body is identical apart from the trailer
  - none of the rewritten or newly pushed commits carries a trailer (28 older commits that were already on
    origin keep theirs; they were out of scope)
- **Backups:** `backup/live-clone-2026-10-14` and `backup/storefront-makeover-2026-10-14`.
- **Local `main`:** never pushed. Its tip `92fa734` was inside the rewrite range (it is the base of
  `feat/storefront-makeover`), so the branches carry it as `0f9b9f7` (same tree and parent, no trailer).
  On 2026-10-16 local `main` was moved to `0f9b9f7` as well, so it is again an ancestor of both branches;
  `92fa734` stays reachable from `backup/storefront-makeover-2026-10-14`.
- **Not rewritten:** every commit that was already on a remote branch.
- **filter-branch leftovers:** `refs/original/*` (the same commits as the backup branches) were deleted on
  2026-10-16.

### Main checkout

- `feat/live-clone` is checked out in `~/Local Sites/astro-ms/app-astro`, with `npm ci` run there. The
  `.env` file is identical to the worktree's.
- The build worktree `.claude/worktrees/live-clone` was removed. Its last commit is on the branch.
- The dev shim (`headless-bridge-local.php`, deployed copy equal to the repo's) sends returns to
  `http://localhost:10026`.
- After a Local restart, :10026 serves the clone:
  - `/voruflokkur/skor/`, the product page, `/gera-upp/`, `/min-sida/` and `/karfa/` answer 200
  - `/vara/<slug>` 301s to the live product path
  - the pages load Jost

### Push

`feat/storefront-makeover` and `feat/live-clone` were pushed to `origin` (github.com/Asdisarson/musikogsport)
as new branches with upstream tracking:
- 44 new commits beyond what origin already had (43 in the first push, then this ticket's commit), none
  with a trailer
- nothing goes to `main`
- no force

### Left for the user

- **Run `/verify`.** It is user-invoke-only. The handle is :10026; the guide is
  `.claude/skills/verify/SKILL.md`.
- **Opening a pull request** and merging it are the user's call.
- **Recommendations from ticket 10:**
  - Rotate the Mailchimp key that is in the dump.
  - The local GraphQL JWT secret was printed into a transcript once.
