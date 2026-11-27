import { describe, expect, it } from 'vitest';
import { adminBarLinks, canEditProducts, hasCookie } from './editor';

describe('canEditProducts', () => {
  it('is true only when WordPress lists edit_products as granted', () => {
    expect(canEditProducts({ read: true, edit_products: true })).toBe(true);
  });

  it('is false for a customer, a denied capability and anything that is not a capability map', () => {
    expect(canEditProducts({ read: true })).toBe(false);
    expect(canEditProducts({ edit_products: false })).toBe(false);
    expect(canEditProducts({ edit_products: 'true' })).toBe(false);
    expect(canEditProducts(null)).toBe(false);
    expect(canEditProducts(undefined)).toBe(false);
    expect(canEditProducts(['edit_products'])).toBe(false);
  });
});

describe('adminBarLinks', () => {
  const base = 'https://wp.example.is';

  it('lists the wp-admin sections on a page without a product', () => {
    expect(adminBarLinks(base, null)).toEqual([
      { label: 'Stjórnborð', href: 'https://wp.example.is/wp-admin/' },
      { label: 'Pantanir', href: 'https://wp.example.is/wp-admin/edit.php?post_type=shop_order' },
      { label: 'Vörur', href: 'https://wp.example.is/wp-admin/edit.php?post_type=product' },
      { label: 'Stillingar', href: 'https://wp.example.is/wp-admin/admin.php?page=mos-settings' },
    ]);
  });

  it('puts "Breyta vöru" first on a product page', () => {
    expect(adminBarLinks(base, 4711)[0]).toEqual({ label: 'Breyta vöru', href: 'https://wp.example.is/wp-admin/post.php?post=4711&action=edit' });
    expect(adminBarLinks(base, 4711)).toHaveLength(5);
  });

  it('ignores a trailing slash or path on the base', () => {
    expect(adminBarLinks('http://localhost:10025/', null)[0].href).toBe('http://localhost:10025/wp-admin/');
    expect(adminBarLinks('https://wp.example.is/some/path', null)[0].href).toBe('https://wp.example.is/wp-admin/');
  });

  it('leaves out the product link for an id that is not a positive integer', () => {
    for (const id of [0, -3, 1.5, Number.NaN]) expect(adminBarLinks(base, id)).toHaveLength(4);
  });

  it('gives no links when the base is not an http(s) origin', () => {
    expect(adminBarLinks('javascript:alert(1)', 5)).toEqual([]);
    expect(adminBarLinks('', 5)).toEqual([]);
    expect(adminBarLinks('not a url', 5)).toEqual([]);
  });
});

describe('hasCookie', () => {
  it('finds a cookie by its exact name, wherever it sits in the string', () => {
    expect(hasCookie('mos_staff=1', 'mos_staff')).toBe(true);
    expect(hasCookie('a=1; mos_staff=1; b=2', 'mos_staff')).toBe(true);
    expect(hasCookie('a=1; mos_li=r', 'mos_li')).toBe(true);
  });

  it('is false for no cookies, another cookie, and a name that only starts or ends the same', () => {
    expect(hasCookie('', 'mos_staff')).toBe(false);
    expect(hasCookie('mos_li=1', 'mos_staff')).toBe(false);
    expect(hasCookie('mos_staff_old=1', 'mos_staff')).toBe(false);
    expect(hasCookie('x_mos_staff=1', 'mos_staff')).toBe(false);
  });
});
