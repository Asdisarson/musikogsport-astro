// /min-sida/ data — SERVER-ONLY. Every call takes the customer id from the verified session
// (lib/auth currentUser), never from the request, so one customer can't read or edit another's data.
import { wooGet, wooSend, WooHttpError } from './woo';
import type { Address } from './accountFormat';
import { orderAmounts, type RawOrderMoney } from './orderAmounts';
import { verifiedUser, type AuthUser } from './auth';

export interface Customer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  billing: Address;
  shipping: Address;
}

export interface OrderRow {
  id: number;
  number: string;
  date_created: string;
  status: string;
  total: string;
  items: number;
}

export interface OrderDetail extends OrderRow {
  customer_id: number;
  payment_method_title: string;
  customer_note: string;
  discount_total: string;
  line_items: { name: string; quantity: number; total: string }[];
  shipping_lines: { title: string; total: string }[];
  billing: Address;
  shipping: Address;
}

// WooCommerce's order status names in Icelandic.
export const STATUS_LABELS: Record<string, string> = {
  pending: 'Bíður greiðslu',
  processing: 'Í vinnslu',
  'on-hold': 'Í bið',
  completed: 'Lokið',
  cancelled: 'Hætt við',
  refunded: 'Endurgreitt',
  failed: 'Mistókst',
  'checkout-draft': 'Drög',
};

/** WooCommerce couldn't answer (transport failure, timeout, 5xx, refused keys): the page says so (503) instead of
 *  showing an empty form or a missing order. */
export type Unavailable = 'unavailable';

/** The account pages' notice for that case. */
export const UNAVAILABLE_TEXT = 'Ekki tókst að sækja upplýsingarnar: þjónustan svaraði ekki. Reyndu aftur eftir smá stund.';

/** "Not there": WooCommerce looked and answered 404 (no such customer/order) or 400 (an id or page it refuses). */
const isMissing = (err: unknown): boolean => err instanceof WooHttpError && (err.status === 404 || err.status === 400);

/** The customer, null when WooCommerce has none with this id, 'unavailable' when it couldn't be asked. */
export async function loadCustomer(id: number): Promise<Customer | null | Unavailable> {
  let data: Record<string, unknown> | null;
  try {
    ({ data } = await wooGet<Record<string, unknown>>(`/customers/${id}`, { _fields: 'id,email,first_name,last_name,username,billing,shipping' }));
  } catch (err) {
    return isMissing(err) ? null : 'unavailable';
  }
  if (!data || data.id !== id) return null;
  return {
    id,
    email: String(data.email ?? ''),
    first_name: String(data.first_name ?? ''),
    last_name: String(data.last_name ?? ''),
    display_name: String(data.first_name || data.username || data.email || ''),
    billing: (data.billing as Address) ?? {},
    shipping: (data.shipping as Address) ?? {},
  };
}

/** The customer or null, an outage included: the checkout's address prefill, which simply starts empty then. */
export async function getCustomer(id: number): Promise<Customer | null> {
  const c = await loadCustomer(id);
  return c === 'unavailable' ? null : c;
}

export function updateCustomer(id: number, patch: Record<string, unknown>): Promise<unknown> {
  return wooSend('PUT', `/customers/${id}`, patch);
}

/** One page of the customer's orders; 'out-of-range' for a page past the last (WooCommerce answers 400 for it).
 *  Throws on an outage. */
export async function listOrders(customerId: number, page: number): Promise<{ orders: OrderRow[]; totalPages: number } | 'out-of-range'> {
  let res: { data: Record<string, unknown>[]; totalPages: number };
  try {
    res = await wooGet<Record<string, unknown>[]>('/orders', {
      customer: customerId,
      page,
      per_page: 10,
      orderby: 'date',
      order: 'desc',
      _fields: 'id,number,date_created,status,total,line_items',
    });
  } catch (err) {
    if (err instanceof WooHttpError && err.status === 400) return 'out-of-range';
    throw err;
  }
  const { data, totalPages } = res;
  return {
    totalPages,
    orders: data.map((o) => ({
      id: Number(o.id),
      number: String(o.number ?? o.id),
      date_created: String(o.date_created ?? ''),
      status: String(o.status ?? ''),
      total: String(o.total ?? ''),
      items: ((o.line_items as { quantity?: number }[]) ?? []).reduce((n, li) => n + Number(li.quantity ?? 0), 0),
    })),
  };
}

/** Put a just-placed (guest) order on the signed-in customer's account, and save its addresses on the
 *  account as WooCommerce's own checkout does (sync_customer_data_with_order runs only for orders placed
 *  with a customer, and the Store API checkout here is always a guest one). One retry; logs, never throws. */
export async function attachOrderToCustomer(orderId: number, customerId: number, opts: { copyAddresses?: boolean } = {}): Promise<boolean> {
  const copyAddresses = opts.copyAddresses ?? true;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // customer_id alone: WooCommerce doesn't recalculate totals for it.
      const order = await wooSend<{ billing?: Address; shipping?: Address } | null>('PUT', `/orders/${orderId}`, { customer_id: customerId }, 'billing,shipping');
      if (!order || !copyAddresses) return true; // linked (an unreadable response has no addresses to copy)
      await wooSend('PUT', `/customers/${customerId}`, { billing: order.billing ?? {}, shipping: order.shipping ?? {} }, 'id').catch((err) =>
        console.warn(`[account] addresses of order ${orderId} not saved on customer ${customerId}: ${err instanceof Error ? err.message : String(err)}`),
      );
      return true;
    } catch (err) {
      console.warn(`[account] order ${orderId} not attached to customer ${customerId} (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return false;
}

const LINK_RETRY_MS = [5_000, 30_000, 120_000];

/** Put an order placed by a signed-in shopper on their account, using who WordPress said they were when the
 *  order was placed. Only when it couldn't say then does this ask again, for about two and a half minutes.
 *  Never throws; meant to run after the checkout response (in-process: a restart in that window leaves the
 *  order as a guest order). */
export async function linkOrderToSignedIn(token: string, orderId: number, atOrder: AuthUser | 'unavailable'): Promise<void> {
  try {
    let user: AuthUser | null | 'unavailable' = atOrder;
    for (let i = 0; user === 'unavailable' && i < LINK_RETRY_MS.length; i++) {
      await new Promise((r) => setTimeout(r, LINK_RETRY_MS[i]));
      user = await verifiedUser(token, true);
    }
    if (user === 'unavailable') console.warn(`[account] order ${orderId} left as a guest order: WordPress couldn't confirm the customer`);
    else if (!user) console.warn(`[account] order ${orderId} left as a guest order: the session was signed out before it could be linked`);
    // A late link only sets the customer: the shopper may have edited their saved addresses meanwhile.
    else await attachOrderToCustomer(orderId, user.id, { copyAddresses: atOrder !== 'unavailable' });
  } catch (err) {
    console.warn(`[account] order ${orderId} not linked: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The order if it belongs to this customer; null otherwise (same answer as a missing order); 'unavailable' when
 *  WooCommerce couldn't be asked. */
export async function getOwnOrder(customerId: number, orderId: number): Promise<OrderDetail | null | Unavailable> {
  let o: Record<string, unknown> | null;
  try {
    ({ data: o } = await wooGet<Record<string, unknown>>(`/orders/${orderId}`, {
      _fields: 'id,number,date_created,status,total,customer_id,payment_method_title,customer_note,discount_total,discount_tax,line_items,shipping_lines,billing,shipping',
    }));
  } catch (err) {
    return isMissing(err) ? null : 'unavailable';
  }
  if (!o || Number(o.customer_id) !== customerId) return null;
  const amounts = orderAmounts(o as RawOrderMoney);
  return {
    id: Number(o.id),
    number: String(o.number ?? o.id),
    date_created: String(o.date_created ?? ''),
    status: String(o.status ?? ''),
    total: String(o.total ?? ''),
    items: amounts.items.reduce((n, li) => n + li.quantity, 0),
    customer_id: customerId,
    payment_method_title: String(o.payment_method_title ?? ''),
    customer_note: String(o.customer_note ?? ''),
    discount_total: String(amounts.discount),
    line_items: amounts.items,
    shipping_lines: amounts.shipping,
    billing: (o.billing as Address) ?? {},
    shipping: (o.shipping as Address) ?? {},
  };
}
