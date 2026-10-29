// LM-01, server side: what became of a checkout attempt the storefront stopped waiting for. SERVER-ONLY.
//
// Why a lost answer is recoverable, and why a retry never makes a second order (WooCommerce 11.2.1 source,
// plugins/woocommerce/src/StoreApi):
//  - The order is created at place-order time (Routes/V1/Checkout.php process_order -> create_or_update_draft_order,
//    deferred to POST since 10.8), and it reuses the session's order: a draft, or a pending/failed one whose cart
//    hash is unchanged (Utilities/DraftOrderTrait::is_valid_draft_order). So a second "Panta" on the same Cart-Token
//    works on the same order; after a completed bank-transfer order the cart is empty and a retry stops at
//    validate_cart_not_empty. This is why the Cart-Token cookie is never touched on a lost answer.
//  - GET /checkout is no read-only probe: with an order in the session it rewrites it from the cart
//    (Checkout.php get_route_response -> create_or_update_draft_order), racing the request still running in PHP, and
//    it returns nothing for an on-hold (placed bank-transfer) order. The session's `order_awaiting_payment`
//    (CheckoutTrait::process_payment) is saved before the gateway runs but no API reads it.
//  - So the order is tagged instead: the attempt id travels in extensions.mos, mos-checkout-fields.php stores it as
//    order meta before payment (`woocommerce_store_api_checkout_update_order_from_request`, saved by
//    update_status('pending')), and it is looked up read-only through the WC REST orders collection (woo.ts).
import type { APIContext } from 'astro';
import { findAttemptOrder, type AttemptOrder } from './woo';
import { writeOrderCookie } from './cartProxy';
import { readAuthToken, verifiedUser } from './auth';
import { linkOrderToSignedIn } from './account';
import { jsonResponse } from './http';
import { log } from './logger';
import { UNCONFIRMED_MESSAGE, AWAITING_PAYMENT_MESSAGE, type CheckoutState } from './checkoutFlow';

export type AttemptOutcome =
  | { state: 'placed'; orderId: number; orderKey: string }
  | { state: 'awaiting-payment'; orderId: number }
  | { state: 'unconfirmed'; reason: 'none' | 'in-progress' | 'unavailable' };

/** WooCommerce's statuses for an order that went through (paid, or bank transfer awaiting the transfer). */
const PLACED = new Set(['on-hold', 'processing', 'completed']);
/** Gateways that take payment on their own page after the order is created: their order is pending until the
 *  shopper pays there (Straumur creates a hosted session in process_payment and charges nothing itself). */
const HOSTED_PAYMENT = new Set(['straumur']);

export function classifyAttemptOrder(order: AttemptOrder | null): AttemptOutcome {
  if (!order) return { state: 'unconfirmed', reason: 'none' };
  if (PLACED.has(order.status)) return { state: 'placed', orderId: order.id, orderKey: order.order_key };
  if (order.status === 'pending' || order.status === 'failed') {
    return HOSTED_PAYMENT.has(order.payment_method) ? { state: 'awaiting-payment', orderId: order.id } : { state: 'unconfirmed', reason: 'in-progress' };
  }
  if (order.status === 'checkout-draft') return { state: 'unconfirmed', reason: 'in-progress' };
  return { state: 'unconfirmed', reason: 'none' }; // cancelled, refunded, trashed: not an order to show
}

/** Look the attempt's order up (read-only). An outage is 'unconfirmed', never an error. */
export async function recoverCheckoutAttempt(attempt: string): Promise<AttemptOutcome> {
  try {
    return classifyAttemptOrder(await findAttemptOrder(attempt));
  } catch {
    return { state: 'unconfirmed', reason: 'unavailable' };
  }
}

/** The shopper-facing state, with its side effects: a placed order gets the receipt cookie (`mos_order`, as a normal
 *  checkout does) and, for a signed-in shopper, goes on their account. */
export async function settleAttempt(ctx: APIContext, outcome: AttemptOutcome): Promise<CheckoutState> {
  if (outcome.state === 'placed') {
    writeOrderCookie(ctx, { order_id: outcome.orderId, order_key: outcome.orderKey });
    const authToken = readAuthToken(ctx.cookies);
    const shopper = authToken ? await verifiedUser(authToken) : null;
    if (authToken && shopper) void linkOrderToSignedIn(authToken, outcome.orderId, shopper);
    return { checkout: 'placed', order_id: outcome.orderId };
  }
  if (outcome.state === 'awaiting-payment') return { checkout: 'awaiting-payment', order_id: outcome.orderId };
  return { checkout: 'unconfirmed' };
}

/** /api/checkout's answer after a lost Store API answer: 200 placed, 409 awaiting payment, 504 unconfirmed. */
export async function respondLostCheckout(ctx: APIContext, attempt: string, cause: string): Promise<Response> {
  const outcome = await recoverCheckoutAttempt(attempt);
  // No PII: the attempt cut to 8 characters (a correlation handle, not the bearer secret) and the outcome.
  log.warn(`[checkout] no answer from WooCommerce (${cause}); recovery: ${outcome.state}${outcome.state === 'unconfirmed' ? `/${outcome.reason}` : ` #${outcome.orderId}`}`, {
    attempt: attempt.slice(0, 8),
  });
  const state = await settleAttempt(ctx, outcome);
  if (state.checkout === 'placed') return jsonResponse(state, 200);
  if (state.checkout === 'awaiting-payment') return jsonResponse({ ...state, message: AWAITING_PAYMENT_MESSAGE }, 409);
  return jsonResponse({ ...state, message: UNCONFIRMED_MESSAGE }, 504);
}

/** WooCommerce answered with an error of its own, but the order may exist anyway: BACS puts the order on hold and fires
 *  the status hooks (e-mails, other plugins') before it empties the cart, so an exception there is answered as a coded
 *  error while the order is placed, and a retry with the full cart would make a second one (on-hold orders are not
 *  reused). So ask, read-only, whether this attempt's order went through. Only a PLACED order overrides the answer
 *  (200 placed, as after a lost answer); anything else, an outage included, leaves WooCommerce's answer to be shown. */
export async function placedDespiteError(ctx: APIContext, attempt: string, status: number): Promise<Response | null> {
  const outcome = await recoverCheckoutAttempt(attempt);
  if (outcome.state !== 'placed') return null;
  log.warn(`[checkout] WooCommerce answered ${status} but the order was placed; recovery: placed #${outcome.orderId}`, { attempt: attempt.slice(0, 8) });
  return jsonResponse(await settleAttempt(ctx, outcome), 200);
}
