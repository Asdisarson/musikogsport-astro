// The money path's time budgets in one place (LM-02), shared by the browser (cartStore, CheckoutForm) and the server
// (storeApi, woo, the checkout routes). Client-safe: constants only.
//
// The order matters more than the numbers: each caller waits longer than the work it waits on. A browser that gave up
// first would lose the server's answer (and the rotated Cart-Token cookie in it), and its cart queue would start the
// next call while our server was still waiting on the last one. WordPress itself can keep running a request after our
// server stops waiting (PHP finishes the work), which no timeout here can prevent: a cart call that timed out is
// followed by a fresh read of the cart (cartStore), and a checkout that timed out by the recovery lookup (LM-01).

/** The server's wait for one Store API call. Shipping quotes and order placement call Pósturinn's rate API, which can
 *  take several seconds (some postcodes ~4 s warm), so this is a generous backstop, not a target. */
export const STORE_API_TIMEOUT_MS = 25_000;

/** The server's wait for one WooCommerce REST read (catalog, order lookups, checkout recovery). */
export const WOO_REST_TIMEOUT_MS = 5_000;

/** The browser's wait for one cart call: the server's Store API wait plus headroom for the hop and the answer. */
export const CART_CLIENT_TIMEOUT_MS = STORE_API_TIMEOUT_MS + 5_000;

/** The browser's wait for placing an order: the Store API checkout, then (after a time-out) one recovery read. */
export const CHECKOUT_CLIENT_TIMEOUT_MS = 45_000;

/** After a checkout whose outcome is unknown, the browser asks /api/checkout/status this often (LM-01). */
export const CHECKOUT_RECOVERY_POLL = { tries: 6, intervalMs: 4_000 } as const;
