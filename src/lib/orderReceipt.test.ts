// PA-06: the order-received page confirms ("móttekin") only an order it could verify; a wrong key or a missing order
// gets neutral copy and 404, an outage a 503 notice. The copy never claims success it can't back.
import { describe, expect, it } from 'vitest';
import { RECEIPT_NOTICE, receiptKey, receiptStatus } from './orderReceipt';

describe('receiptKey', () => {
  const cookie = { id: 42, key: 'wc_order_cookie', seen: false };
  it('takes the key from the URL first, else from the checkout cookie of the same order', () => {
    expect(receiptKey(42, 'wc_order_url', cookie)).toEqual({ key: 'wc_order_url', placedHere: true });
    expect(receiptKey(42, null, cookie)).toEqual({ key: 'wc_order_cookie', placedHere: true });
    expect(receiptKey(43, null, cookie)).toEqual({ key: '', placedHere: false });
    expect(receiptKey(42, '', null)).toEqual({ key: '', placedHere: false });
  });
});

describe('receiptStatus / RECEIPT_NOTICE', () => {
  it('200 for a verified order, 404 for a miss, 503 for an outage', () => {
    expect(receiptStatus('found')).toBe(200);
    expect(receiptStatus('not-found')).toBe(404);
    expect(receiptStatus('unavailable')).toBe(503);
  });

  it('the miss and outage copy never says the order was received', () => {
    for (const notice of [RECEIPT_NOTICE['not-found'], RECEIPT_NOTICE.unavailable]) {
      const all = `${notice.title} ${notice.body}`;
      expect(all).not.toMatch(/móttekin|Takk fyrir/i);
      expect(all).toMatch(/tölvupóst/); // a real shopper without the cookie is pointed at the confirmation e-mail
    }
    expect(RECEIPT_NOTICE.unavailable.body).toMatch(/aftur/);
  });
});
