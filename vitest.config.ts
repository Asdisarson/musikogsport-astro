import { defineConfig } from 'vitest/config';

// Only the storefront's own tests: `.claude/worktrees/*` holds old copies of the repo whose tests would otherwise
// run too (and be counted) on every `npm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/.claude/**', 'dist/**'],
  },
});
