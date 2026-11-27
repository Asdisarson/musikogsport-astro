// Every page in src/routes is mounted on its address once, and none is left unmounted.
import { describe, expect, it } from 'vitest';
import { LOCALIZED_ROUTES } from './localizedRoutes.mjs';

const files = Object.keys(import.meta.glob('../routes/**/*.astro')).map((f) => f.replace('../routes/', ''));

describe('localized routes', () => {
  it('mounts every file in src/routes, each once', () => {
    expect([...LOCALIZED_ROUTES.map(([, f]) => f)].sort()).toEqual([...files].sort());
  });
  it('gives every address once', () => {
    const patterns = LOCALIZED_ROUTES.map(([p]) => p);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});
