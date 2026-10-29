import { describe, expect, it } from 'vitest';
import { formatSaleBadge, salePercent } from './price';

const sale = '<del aria-hidden="true"><span class="woocommerce-Price-amount amount">13.990&nbsp;<span class="woocommerce-Price-currencySymbol">kr.</span></span></del> <span class="screen-reader-text">Original price was: 13.990&nbsp;kr..</span><ins aria-hidden="true"><span class="woocommerce-Price-amount amount">7.000&nbsp;<span class="woocommerce-Price-currencySymbol">kr.</span></span></ins>';

describe('salePercent', () => {
  it('computes the rounded discount from the struck and sale amounts in price_html', () => {
    expect(salePercent(sale)).toBe(50);
  });

  it('returns null when the price is not discounted', () => {
    expect(salePercent('<span class="woocommerce-Price-amount amount">15.990&nbsp;kr.</span>')).toBeNull();
    expect(salePercent('')).toBeNull();
    expect(salePercent(undefined)).toBeNull();
  });

  it('returns null for nonsense amounts instead of a bogus badge', () => {
    expect(salePercent('<del>0 kr.</del><ins>0 kr.</ins>')).toBeNull();
    expect(salePercent('<del>5.000 kr.</del><ins>9.000 kr.</ins>')).toBeNull();
  });
});

describe('formatSaleBadge', () => {
  it('labels a discount as a compact "-N%" chip, the same on cards and the product page', () => {
    expect(formatSaleBadge(55)).toBe('-55%');
    expect(formatSaleBadge(7)).toBe('-7%');
  });
});
