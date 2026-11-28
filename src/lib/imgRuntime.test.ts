// The photo folder's place against the page store's folder: the helper that says whether the store would wipe it.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.test' }));
import { imgRootInShellFolder, type PathFs } from './imgRuntime';

/** A fake volume: only the folders listed exist. On a folding volume a path matches in any letter case. */
function fakeFs(folders: string[], folds: boolean): PathFs {
  const key = (p: string) => (folds ? p.toLowerCase() : p);
  const names = [...new Set(folders.map(key))];
  const find = (p: string) => {
    const i = names.indexOf(key(p));
    if (i < 0) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return i;
  };
  return {
    realpathSync: (p) => (find(p), p),
    statSync: (p) => ({ dev: 1, ino: find(p) + 1 }),
  };
}

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('imgRootInShellFolder', () => {
  it('is true when the photo folder is the shell folder, however the two are written', () => {
    expect(imgRootInShellFolder('/data/shells', '/data/shells')).toBe(true);
    expect(imgRootInShellFolder('/data/shells/', '/data/shells')).toBe(true);
    expect(imgRootInShellFolder('/data/shells', '/data/shells/')).toBe(true);
    expect(imgRootInShellFolder('/data/x/../shells', '/data/shells')).toBe(true);
  });

  it('is true when the photo folder is inside the shell folder', () => {
    expect(imgRootInShellFolder('/data/shells/img', '/data/shells')).toBe(true);
    expect(imgRootInShellFolder('/data/shells/img/', '/data/shells/')).toBe(true);
  });

  it('is false for a sibling, a parent, or a name that only starts with the shell folder name', () => {
    expect(imgRootInShellFolder('/data/img', '/data/shells')).toBe(false);
    expect(imgRootInShellFolder('/data', '/data/shells')).toBe(false);
    expect(imgRootInShellFolder('/data/shells-img', '/data/shells')).toBe(false);
    expect(imgRootInShellFolder('/data/..shells', '/data/shells')).toBe(false);
  });
});

describe('imgRootInShellFolder against the volume', () => {
  it('finds a case-only overlap on a volume that folds case', () => {
    const fs = fakeFs(['/data', '/data/shells'], true);
    expect(imgRootInShellFolder('/Data/SHELLS/img', '/data/shells', fs)).toBe(true);
    expect(imgRootInShellFolder('/data/Shells', '/data/shells', fs)).toBe(true);
    expect(imgRootInShellFolder('/Data/Shells-img', '/data/shells', fs)).toBe(false);
  });

  it('does not treat a case-only difference as overlap on a case-sensitive volume', () => {
    const fs = fakeFs(['/data', '/data/shells'], false);
    expect(imgRootInShellFolder('/data/SHELLS/img', '/data/shells', fs)).toBe(false);
    expect(imgRootInShellFolder('/data/shells/img', '/data/shells', fs)).toBe(true);
  });

  it('resolves a missing folder against its nearest existing ancestor (the tail is re-appended)', () => {
    const fs = fakeFs(['/data', '/data/shells'], false);
    // /data/shells/a/b does not exist yet; it is still inside the shell folder
    expect(imgRootInShellFolder('/data/shells/a/b', '/data/shells', fs)).toBe(true);
    // a missing shell folder: its photos folder is not inside an existing sibling
    expect(imgRootInShellFolder('/data/img/x', '/data/missing', fs)).toBe(false);
  });

  it('finds an overlap through a symlink, with real folders (the photo folder is reached through the link)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mos-imgroot-'));
    made.push(root);
    const store = join(root, 'shells');
    mkdirSync(store);
    const link = join(root, 'link');
    symlinkSync(store, link);
    // the photo folder does not exist yet; through the link it is inside the store
    expect(imgRootInShellFolder(join(link, 'img'), store)).toBe(true);
    expect(imgRootInShellFolder(join(link, 'img'), join(root, 'other'))).toBe(false);
  });
});

