import { describe, expect, it } from 'vitest';
import { mapStoreProduct, type StoreProductRaw } from './storeMap';

const base = (over: Partial<StoreProductRaw> = {}): StoreProductRaw => ({
  id: 7,
  name: 'Skór',
  slug: 'skor',
  type: 'simple',
  prices: { price: '1990000', regular_price: '1990000', sale_price: '1990000', currency_minor_unit: 2 },
  on_sale: false,
  is_in_stock: true,
  ...over,
});

// The Store API's image shape, as /wc/store/v1/products returns it on this store (trimmed).
const storeImage = {
  id: 264822,
  src: 'http://localhost:10025/wp-content/uploads/2026/04/a.jpg.webp',
  thumbnail: 'http://localhost:10025/wp-content/uploads/2026/04/a.jpg-450x450.webp',
  srcset:
    'http://localhost:10025/wp-content/uploads/2026/04/a.jpg.webp 1200w, http://localhost:10025/wp-content/uploads/2026/04/a.jpg-720x720.webp 720w, http://localhost:10025/wp-content/uploads/2026/04/a.jpg-360x360.webp 360w',
  sizes: '(max-width: 1200px) 100vw, 1200px',
  name: 'a.jpg',
  alt: 'Skór á hlið',
};

describe('mapStoreProduct', () => {
  it('keeps the image srcset, sizes and 450px thumbnail (raw; the card rewrites the host)', () => {
    const p = mapStoreProduct(base({ images: [storeImage] }));
    expect(p.images).toEqual([
      { src: storeImage.src, alt: 'Skór á hlið', srcset: storeImage.srcset, sizes: storeImage.sizes, thumbnail: storeImage.thumbnail },
    ]);
  });

  it('leaves the optional image fields out when the Store API has none', () => {
    const p = mapStoreProduct(base({ images: [{ src: 'http://localhost:10025/x.jpg' }] }));
    expect(p.images).toEqual([{ src: 'http://localhost:10025/x.jpg', alt: '' }]);
  });

  it('scales the minor-unit prices and blanks a variable product’s regular/sale prices', () => {
    expect(mapStoreProduct(base()).price).toBe('19900');
    const v = mapStoreProduct(base({ type: 'variable', prices: { price: '500', regular_price: '900', sale_price: '500', currency_minor_unit: 0 } }));
    expect([v.price, v.regular_price, v.sale_price]).toEqual(['500', '', '']);
  });
});
