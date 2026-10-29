// The checkout page's side of placing an order: the body it sends (CO-21), and what it does with every answer,
// including no answer at all (LM-01). Client-safe: no server imports; the server's recovery (lib/checkoutRecovery)
// shares the state shape and the messages from here.
import { decodeEntities } from './decode';
import { paymentRedirectTarget } from './checkoutRedirect';
import { CHECKOUT_RECOVERY_POLL } from './timeouts';

/** The checkout form's address fields (billing; the shipping form uses the same shape without e-mail). */
export interface FormAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  postcode: string;
  city: string;
  phone: string;
  email: string;
}

/** A Store API address from the form. The shopper's phone (billing) goes on both, as on live. */
export function addressFor(a: FormAddress, phone: string) {
  return {
    first_name: a.first_name.trim(),
    last_name: a.last_name.trim(),
    company: a.company.trim(),
    address_1: a.address_1.trim(),
    address_2: a.address_2.trim(),
    city: a.city.trim(),
    state: '',
    postcode: a.postcode.trim(),
    country: 'IS',
    phone: phone.trim(),
  };
}

export interface CheckoutInput {
  billing: FormAddress;
  /** The delivery address: the shipping form, or the billing one. */
  ship: FormAddress;
  notes: string;
  paymentMethod: string;
  /** The cart's needs_payment: false for a free order (a 100 % coupon). */
  needsPayment: boolean;
  kennitala: string;
  skiptimidi: boolean;
  /** The chosen Pósturinn locker id, when the shipping rate needs one. */
  postbox: string | null;
  attempt: string;
}

/** The /api/checkout body. The server forwards only these fields (lib/checkoutPayload, LM-03). */
export function checkoutBody(f: CheckoutInput) {
  return {
    billing_address: { ...addressFor(f.billing, f.billing.phone), email: f.billing.email.trim() },
    shipping_address: addressFor(f.ship, f.billing.phone),
    customer_note: f.notes.trim(),
    // A free order takes no payment: send no gateway, as WooCommerce's own checkout does, so it isn't recorded as a
    // card or bank-transfer order (CO-21). WooCommerce refuses the order if it does need one after all.
    ...(f.needsPayment && f.paymentMethod ? { payment_method: f.paymentMethod } : {}),
    payment_data: [] as { key: string; value: string }[],
    extensions: { mos: { kennitala: f.kennitala.replace(/\D/g, '') || null, skiptimidi: f.skiptimidi, attempt: f.attempt } },
    // Pósturinn's own Store API hook reads the locker off the top level of the request.
    ...(f.postbox ? { postis_dpo_postbox: f.postbox, postis_dpo_phonenumber: f.billing.phone.trim() } : {}),
  };
}

// ---------- the outcome of an order whose answer was lost (LM-01) ----------

/** What the storefront knows about a checkout attempt it stopped waiting for:
 *  placed: WooCommerce placed the order (the `mos_order` cookie is set, the receipt shows it);
 *  awaiting-payment: a card order exists but its payment page never opened (no money moved; "Panta" again reuses
 *    the same order, WooCommerce's pending-order retry);
 *  unconfirmed: not known (still running, not created, or WordPress didn't answer). */
export type CheckoutState =
  | { checkout: 'placed'; order_id: number }
  | { checkout: 'awaiting-payment'; order_id: number }
  | { checkout: 'unconfirmed' };

export const UNCONFIRMED_MESSAGE =
  'Ekki tókst að staðfesta hvort pöntunin fór í gegn. Ef hún fór í gegn færðu staðfestingu í tölvupósti innan skamms. ' +
  'Athugaðu tölvupóstinn þinn áður en þú pantar aftur.';
export const AWAITING_PAYMENT_MESSAGE =
  'Pöntunin þín var vistuð en greiðslan hófst ekki og ekkert var greitt. Smelltu aftur á „Panta“ til að greiða; sama pöntun er notuð.';
/** Shown while the page asks whether the order went through. */
export const CHECKING_MESSAGE = 'Svar barst ekki frá vefversluninni. Athuga hvort pöntunin fór í gegn…';

export function parseCheckoutState(data: unknown): CheckoutState | null {
  if (!data || typeof data !== 'object') return null;
  const { checkout, order_id } = data as { checkout?: unknown; order_id?: unknown };
  if (checkout === 'unconfirmed') return { checkout };
  if ((checkout === 'placed' || checkout === 'awaiting-payment') && Number.isInteger(order_id) && (order_id as number) > 0) {
    return { checkout, order_id: order_id as number };
  }
  return null;
}

interface PollDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  tries?: number;
  intervalMs?: number;
}

/** Ask /api/checkout/status whether the attempt's order exists, a few times, giving WordPress time to finish an
 *  order the storefront stopped waiting for. Read-only on the server: it never places or changes an order. */
export async function pollCheckoutStatus(attempt: string, deps: PollDeps = {}): Promise<CheckoutState> {
  const {
    fetchImpl = (url, init) => fetch(url, init),
    sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    tries = CHECKOUT_RECOVERY_POLL.tries,
    intervalMs = CHECKOUT_RECOVERY_POLL.intervalMs,
  } = deps;
  for (let i = 0; i < tries; i++) {
    await sleep(intervalMs);
    try {
      const res = await fetchImpl('/api/checkout/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429) break; // asked too often: more asking won't help
      const state = res.ok ? parseCheckoutState(await res.json().catch(() => null)) : null;
      if (state && state.checkout !== 'unconfirmed') return state;
    } catch {
      /* no answer: ask again */
    }
  }
  return { checkout: 'unconfirmed' };
}

/** What the page does next: go somewhere (the payment page or the receipt), or show a message and let the
 *  shopper act again. */
export type SubmitOutcome = { kind: 'go'; url: string; resetCart: boolean } | { kind: 'error'; message: string };

const FAILED_URL = '/gera-upp/?straumurStatus=failed';

/** A gateway status without WooCommerce's own error body (`code`): a proxy gave up waiting, so whatever was behind
 *  it may still have placed the order. */
export function isLostAnswer(status: number, data: unknown): boolean {
  const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
  return (status === 502 || status === 503 || status === 504) && typeof code !== 'string';
}
const receipt = (orderId: number) => `/gera-upp/order-received/${orderId}/`;

function recovered(state: CheckoutState): SubmitOutcome {
  if (state.checkout === 'placed') return { kind: 'go', url: receipt(state.order_id), resetCart: true };
  if (state.checkout === 'awaiting-payment') return { kind: 'error', message: AWAITING_PAYMENT_MESSAGE };
  return { kind: 'error', message: UNCONFIRMED_MESSAGE };
}

interface SubmitDeps {
  /** POSTs the body to /api/checkout (in the cart queue); rejects when no answer arrives. */
  send: (init: RequestInit) => Promise<Response>;
  /** Asks whether the attempt's order exists (pollCheckoutStatus). */
  poll: (attempt: string) => Promise<CheckoutState>;
  origin: string;
  /** Called once when the answer was lost and the page starts asking. */
  onRecovering?: () => void;
}

/** Place the order and decide what the page does next. Never sends the order twice: after a lost answer it only
 *  asks (read-only) what became of this attempt. */
export async function submitCheckout(body: unknown, attempt: string, deps: SubmitDeps): Promise<SubmitOutcome> {
  let res: Response | null = null;
  try {
    res = await deps.send({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    res = null; // offline, a dropped connection, our own time-out: the order may or may not have been placed
  }
  const data: unknown = res ? await res.json().catch(() => null) : null;
  const state = !res || isLostAnswer(res.status, data) ? parseCheckoutState(data) ?? { checkout: 'unconfirmed' as const } : parseCheckoutState(data);
  if (state?.checkout === 'unconfirmed') {
    deps.onRecovering?.();
    return recovered(await deps.poll(attempt));
  }
  if (state) return recovered(state);

  const d = (data ?? {}) as { order_id?: unknown; order_key?: unknown; message?: unknown; payment_result?: { redirect_url?: unknown } };
  if (!res || !res.ok || !d.order_id) {
    // Decode server entities; only decode a real string so a malformed body can't throw here.
    const msg = typeof d.message === 'string' ? decodeEntities(d.message) : '';
    return { kind: 'error', message: msg || 'Ekki tókst að ganga frá pöntun.' };
  }
  // Redirect gateways (Straumur hosted checkout) hand back a URL: follow it and keep the cart (a declined card comes
  // back to this checkout with it; the receipt starts a fresh cart). Bank transfer's URL is the receipt.
  const redirect = d.payment_result?.redirect_url;
  if (typeof redirect === 'string' && redirect) {
    return { kind: 'go', url: paymentRedirectTarget(redirect, deps.origin) ?? FAILED_URL, resetCart: false };
  }
  const key = typeof d.order_key === 'string' && d.order_key ? `?key=${encodeURIComponent(d.order_key)}` : '';
  return { kind: 'go', url: `${receipt(Number(d.order_id))}${key}`, resetCart: true };
}
