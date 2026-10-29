// The id of one checkout attempt (one press of "Panta"), LM-01. WooCommerce stores it on the order it creates
// (wp-mu-plugins/mos-checkout-fields.php, order meta `_mos_checkout_attempt`), so an order placed after the answer was
// lost can be found again. It is a bearer secret for that lookup: 128 random bits, only ever in POST bodies and logs
// cut to 8 characters. Client-safe.

export const ATTEMPT_ID = /^[0-9a-f]{32}$/;

/** A fresh attempt id: 32 lowercase hex characters (Web Crypto, in the browser and in Node). */
export function newAttemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
