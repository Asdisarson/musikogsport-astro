import { describe, expect, it } from 'vitest';
import { freeShippingProgress, shippingBarMessage } from './shippingBar';

describe('freeShippingProgress', () => {
  it('matches live for a 1.990 kr. cart against the 20.000 kr. goal (9%, 18.010 kr. left)', () => {
    expect(freeShippingProgress(1990, 20000)).toEqual({ percent: 9, remaining: 18010, reached: false });
  });

  it('is complete at or above the goal', () => {
    expect(freeShippingProgress(20000, 20000)).toEqual({ percent: 100, remaining: 0, reached: true });
    expect(freeShippingProgress(25000, 20000)).toEqual({ percent: 100, remaining: 0, reached: true });
  });

  it('treats a missing goal as switched off (never "reached")', () => {
    expect(freeShippingProgress(5000, 0)).toEqual({ percent: 0, remaining: 0, reached: false });
  });
});

describe('shippingBarMessage', () => {
  const bar = { message: '<p>Bættu [missing_amount] meira við</p>', success: '<p><strong>Engin sending!</strong></p>' };

  it('puts the formatted remaining amount where Goya’s [missing_amount] placeholder is', () => {
    expect(shippingBarMessage(bar, { percent: 9, remaining: 18010, reached: false }, (n) => `${n} kr.`)).toBe(
      '<p>Bættu <span class="amount">18010 kr.</span> meira við</p>',
    );
  });

  it('shows the success message once the goal is reached', () => {
    expect(shippingBarMessage(bar, { percent: 100, remaining: 0, reached: true }, String)).toBe(bar.success);
  });
});
