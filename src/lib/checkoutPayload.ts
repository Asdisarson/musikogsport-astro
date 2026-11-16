// The checkout body /api/checkout forwards to the Store API, built from named fields only (LM-03): the fields the
// storefront's checkout form sends (lib/checkoutFlow.checkoutBody), and nothing else. Everything WooCommerce would
// otherwise act on (create_account, customer_password, expected_total, additional_fields, other plugins' extension
// data, ...) is dropped here; of WooCommerce's own extensions only the filtered order attribution goes on. Prices,
// totals and shipping are never in the body: the Store API computes them from its own cart session. Pure; the Store API stays the validator of the values themselves.
import type { CheckoutAddress, CheckoutPayload } from './types';
import { isPlainObject } from './validate';
import { ATTEMPT_ID } from './attemptId';
import { originExtension } from './origin';

const ADDRESS_KEYS = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'] as const;
/** Longest address field kept (as accountFormat does for the account forms). */
const FIELD_MAX = 200;
export const CHECKOUT_NOTE_MAX = 1000;
/** Pósturinn locker ids look like "DPO9552". */
const LOCKER_ID = /^[A-Za-z0-9]{1,32}$/;

const text = (v: unknown, max = FIELD_MAX): string => (typeof v === 'string' ? v.slice(0, max) : '');

function address(raw: unknown): CheckoutAddress | null {
  if (!isPlainObject(raw)) return null;
  const out = {} as CheckoutAddress;
  for (const k of ADDRESS_KEYS) out[k] = text(raw[k]);
  return out;
}

/** The body to forward, or null when it has no billing address with an e-mail (the one thing the route localizes
 *  itself; WooCommerce answers for the rest). */
export function checkoutPayload(raw: unknown, request: { userAgent?: string | null } = {}): CheckoutPayload | null {
  if (!isPlainObject(raw)) return null;
  const billing = address(raw.billing_address);
  const email = isPlainObject(raw.billing_address) ? text(raw.billing_address.email) : '';
  if (!billing || !email.trim()) return null;

  const mosIn = isPlainObject(raw.extensions) && isPlainObject(raw.extensions.mos) ? raw.extensions.mos : {};
  const kennitala = typeof mosIn.kennitala === 'string' ? mosIn.kennitala.replace(/\D/g, '').slice(0, 20) : '';
  const mos: CheckoutPayload['extensions']['mos'] = { kennitala: kennitala || null, skiptimidi: mosIn.skiptimidi === true };
  if (typeof mosIn.attempt === 'string' && ATTEMPT_ID.test(mosIn.attempt)) mos.attempt = mosIn.attempt;

  const payload: CheckoutPayload = {
    billing_address: { ...billing, email },
    customer_note: text(raw.customer_note, CHECKOUT_NOTE_MAX),
    // The form sends none; WooCommerce passes these to the gateway, so nothing from the browser goes through.
    payment_data: [],
    extensions: { mos },
  };
  // The one extension of WooCommerce's own that goes through: where the visit came from, field by field (lib/origin).
  // The user agent is the request's, not the body's.
  const origin = isPlainObject(raw.extensions) ? originExtension(raw.extensions['woocommerce/order-attribution']) : null;
  if (origin) {
    const userAgent = text(request.userAgent);
    payload.extensions['woocommerce/order-attribution'] = { ...origin, ...(userAgent ? { user_agent: userAgent } : {}) };
  }
  const shipping = address(raw.shipping_address);
  if (shipping) payload.shipping_address = shipping;
  // Absent for a free order (CO-21); WooCommerce refuses an order that needs payment without one.
  if (typeof raw.payment_method === 'string' && raw.payment_method.trim()) payload.payment_method = raw.payment_method.trim().slice(0, 64);
  // Pósturinn's Store API hook reads these off the top level of the request (posturinn/inc/blocks-support.php).
  if (typeof raw.postis_dpo_postbox === 'string' && LOCKER_ID.test(raw.postis_dpo_postbox)) {
    payload.postis_dpo_postbox = raw.postis_dpo_postbox;
    if (typeof raw.postis_dpo_phonenumber === 'string') payload.postis_dpo_phonenumber = text(raw.postis_dpo_phonenumber, 32);
  }
  return payload;
}

/** Whether the shopper ticked "Stofna aðgang" (lib/checkoutFlow.checkoutBody). Read by /api/checkout only: the flag
 *  is not part of the forwarded body, and the account is made after the order exists (lib/account). */
export function wantsAccount(raw: unknown): boolean {
  return isPlainObject(raw) && raw.mos_create_account === true;
}
