// Runs before every test file (vitest.config.ts setupFiles). A test that starts a run or saves settings without naming
// a folder used to write into the storefront's real temp folders (<tmp>/mos-shells, <tmp>/mos-img): the Síðugeymsla
// page of a dev server on the same machine then listed the tests' runs. Each test file gets its own throwaway
// folders instead; a test that needs a specific folder sets the variable itself, as before.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'mos-vitest-'));
process.env.MOS_SHELL_DIR = join(root, 'shells');
process.env.MOS_IMG_CACHE_DIR = join(root, 'img');

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
