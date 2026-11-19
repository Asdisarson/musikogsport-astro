// The process-wide upstream budget of /api/live: a token per WooCommerce call, refused calls never reach WooCommerce.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({ log: { warn: vi.fn() } }));

import { budgetSpentResponse, createLiveBudget, LiveBudgetSpent, LIVE_UPSTREAM_PER_MINUTE } from './liveBudget';

describe('createLiveBudget', () => {
  it('lets the limit through per window and refuses the rest without calling WooCommerce', async () => {
    let t = 0;
    const b = createLiveBudget({ limit: 2, windowMs: 1000, now: () => t, warn: () => {} });
    const call = vi.fn(async () => 'ok');
    expect(await b.upstream(call)).toBe('ok');
    expect(await b.upstream(call)).toBe('ok');
    await expect(b.upstream(call)).rejects.toBeInstanceOf(LiveBudgetSpent);
    expect(call).toHaveBeenCalledTimes(2);
    t = 1001; // a new window
    expect(await b.upstream(call)).toBe('ok');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('warns once per window, not once per refused request', async () => {
    const warn = vi.fn();
    const b = createLiveBudget({ limit: 1, windowMs: 1000, now: () => 0, warn });
    await b.upstream(async () => 1);
    for (let i = 0; i < 5; i++) await expect(b.upstream(async () => 1)).rejects.toThrow(LiveBudgetSpent);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is sized well above a busy minute of page views (one or two calls each)', () => {
    expect(LIVE_UPSTREAM_PER_MINUTE).toBeGreaterThanOrEqual(400);
  });
});

describe('budgetSpentResponse', () => {
  it('answers 503 with no-store and a Retry-After', () => {
    const res = budgetSpentResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
