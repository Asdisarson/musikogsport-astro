import type { APIRoute } from 'astro';
import { checkout } from '../../lib/storeApi';
import { badRequest, cartSession, readJson, respondCart, writeOrderCookie } from '../../lib/cartProxy';
import { checkoutPayload } from '../../lib/checkoutPayload';
import { placedDespiteError, respondLostCheckout } from '../../lib/checkoutRecovery';
import { isLostAnswer } from '../../lib/checkoutFlow';
import { newAttemptId } from '../../lib/attemptId';
import { readAuthToken, verifiedUser } from '../../lib/auth';
import { linkOrderToSignedIn } from '../../lib/account';
import { sameOrigin, tooManyRequests } from '../../lib/http';
import { createLimiter } from '../../lib/rateLimit';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// 10 order attempts a minute per visitor: generous for a real customer (a retry after a typo or a declined
// card), enough to stop a bot hammering the order route. Checked before anything reaches WooCommerce.
const WINDOW_MS = 60 * 1000;
const attempts = createLimiter(10, WINDOW_MS);

// Places the order via the Store API. Bacs empties the server-side cart itself and a rotated Cart-Token
// comes back (respondCart persists it); a card gateway (Straumur) leaves the cart full, and the thank-you
// page starts a fresh one. We also stash {order_id, order_key} in a short-lived httpOnly cookie: the
// thank-you page's only source of the key after a card payment (the bridge strips it from the return),
// and its proof that this browser placed the order.
// When WooCommerce's answer is lost (our time-out, a dropped connection, a proxy's gateway page), the order may still
// have been placed: the attempt id finds it again (lib/checkoutRecovery, LM-01). The order is never sent twice.
export const POST: APIRoute = async (ctx) => {
  // It reads the sign-in cookie and can write to the customer's account, like the other cookie-authed POSTs.
  if (!sameOrigin(ctx.request, ctx.url)) return new Response('Forbidden', { status: 403 });
  if (!attempts.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);
  // Only the fields the checkout form sends go on (LM-03). We localize the one missing field we can (the e-mail);
  // the WooCommerce Store API is the authoritative validator for the rest and refuses bad input itself.
  const body = checkoutPayload(await readJson(ctx));
  if (!body) return badRequest('Ógild pöntun. Vantar greiðslu- eða afhendingarupplýsingar.');
  // The browser sends the id it will ask about if this answer is lost; without one, recovery here still works.
  const attempt = body.extensions.mos.attempt ?? newAttemptId();
  body.extensions.mos.attempt = attempt;

  const { token, timeoutMs } = await cartSession(ctx);
  // Who is signed in, as of placing the order (usually memoized from the checkout page).
  const authToken = readAuthToken(ctx.cookies);
  const shopper = authToken ? await verifiedUser(authToken) : null;
  const result = await checkout(body, token, timeoutMs);
  if (result.transportFailure || isLostAnswer(result.status, result.data)) {
    return respondLostCheckout(ctx, attempt, result.transportFailure ?? `upstream ${result.status}`);
  }
  if (!result.ok) {
    // WooCommerce's own error: the order can exist anyway (SR-17). Only a placed one changes the answer.
    const placed = await placedDespiteError(ctx, attempt, result.status);
    if (placed) return placed;
  }
  if (result.ok && result.data?.order_id && result.data?.order_key) {
    writeOrderCookie(ctx, { order_id: result.data.order_id, order_key: result.data.order_key });
    // Signed in at /min-sida/? The order goes on the customer's account (Pantanir), as with WooCommerce.
    // After the response: the hand-off to the card page never waits on it, and a failure is logged without
    // failing the placed order. The customer id is WordPress's answer for this session's token.
    if (authToken && shopper) void linkOrderToSignedIn(authToken, result.data.order_id, shopper);
  }
  // A free order goes without a payment method (CO-21); if the cart needs payment after all, WooCommerce says so in
  // English: say it the way the form does.
  const code = (result.data as { code?: unknown } | null)?.code;
  if (code === 'woocommerce_rest_checkout_missing_payment_method') {
    return respondCart(ctx, { ...result, data: { code, message: 'Veldu greiðslumáta.' } as never });
  }
  return respondCart(ctx, result);
};
