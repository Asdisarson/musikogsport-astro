// Product structured data: price stays in the page, stock never does (it is live, see lib/livePrices).
import { describe, expect, it } from 'vitest';
import { ld, productLd } from './jsonld';

const base = { name: 'Bolur', url: 'https://musikogsport.is/verslun/bolur/', images: ['https://m.test/a.jpg'] };

describe('productLd', () => {
  it('a simple product carries its price and no availability', () => {
    const p = productLd({ ...base, price: '13990' });
    expect(p.offers).toEqual({ '@type': 'Offer', priceCurrency: 'ISK', price: 13990, url: base.url });
    expect(JSON.stringify(p)).not.toMatch(/availability|InStock|OutOfStock/);
  });
  it('a variable product carries its price range and no availability', () => {
    const p = productLd({ ...base, priceRange: { low: 1000, high: 2000, count: 3 } });
    expect(p.offers).toEqual({
      '@type': 'AggregateOffer',
      priceCurrency: 'ISK',
      lowPrice: 1000,
      highPrice: 2000,
      offerCount: 3,
      url: base.url,
    });
    expect(JSON.stringify(p)).not.toMatch(/availability|InStock|OutOfStock/);
  });
  it('an offer without a usable price omits the price rather than sending 0', () => {
    const p = productLd({ ...base, price: '' });
    expect(p.offers).toEqual({ '@type': 'Offer', priceCurrency: 'ISK', url: base.url });
  });
  it('the serialised block cannot close its script element', () => {
    expect(ld({ name: '</script><b>' })).not.toContain('</script');
  });
});
