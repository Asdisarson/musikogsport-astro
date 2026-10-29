import type { APIRoute } from 'astro';
import { clearAuth, currentUser, invalidateUser, rememberedSession, requestToken, setAuth, verifiedUser } from '../../../lib/auth';
import { passwordProblem } from '../../../lib/validate';
import { updateCustomer } from '../../../lib/account';
import { sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';

export const prerender = false;

// /min-sida/edit-account/ — name, email and an optional password change, which needs the current password.
// Wrong current passwords are limited per customer, so a stolen session can't guess the password. The slot
// is taken before asking WordPress (parallel guesses can't all pass) and given back when the password was
// right or WordPress couldn't answer.
const wrongPasswords = createLimiter(5, 15 * 60 * 1000);

/** A token for these credentials, only if WordPress says it is this customer's: the email is the form's,
 *  so it may name someone else's account. */
async function ownToken(customerId: number, email: string, password: string): Promise<string | null> {
  const result = await requestToken(email, password);
  if (!('token' in result)) return null;
  const owner = await verifiedUser(result.token, true);
  return typeof owner === 'object' && owner !== null && owner.id === customerId ? result.token : null;
}

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const user = await currentUser(cookies);
  if (!user) return redirect('/min-sida/', 303);
  const form = await request.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? '').trim().slice(0, 200);
  const back = (error: string) => redirect(`/min-sida/edit-account/?error=${error}`, 303);
  const first = field('account_first_name');
  const last = field('account_last_name');
  const email = field('account_email');
  if (!first || !last || !email) return back('required');
  if (!/^\S+@\S+\.\S+$/.test(email)) return back('email');

  const patch: Record<string, string> = { first_name: first, last_name: last, email };
  const current = String(form?.get('password_current') ?? '');
  const next = String(form?.get('password_1') ?? '');
  if (current || next) {
    if (!current || !next) return back('password_fields');
    if (current.length > 4096) return back('current'); // over WordPress's limit: can't be the password
    const problem = passwordProblem(next);
    if (problem) return back(problem);
    if (next !== String(form?.get('password_2') ?? '')) return back('mismatch');
    const customer = String(user.id);
    if (!wrongPasswords.take(customer)) {
      console.warn(`[account] customer ${customer} hit the wrong-password limit on edit-account`);
      return back('limited');
    }
    const check = await requestToken(user.email, current);
    if ('error' in check) {
      if (check.error === 'rejected') return back('current');
      wrongPasswords.refund(customer);
      return back('unavailable');
    }
    wrongPasswords.refund(customer);
    patch.password = next;
  }
  try {
    await updateCustomer(user.id, patch);
  } catch (err) {
    // WooCommerce refused the change (an email already in use, an invalid field): nothing was saved.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (!timedOut || !patch.password) return back('save');
    // A timeout can come after WooCommerce applied the change. If the new credentials sign this customer
    // in, it did.
    const applied = await ownToken(user.id, email, patch.password);
    // Not yet applied, but a timed-out save may still finish: say so rather than "not saved".
    if (!applied) return back('maybe');
    invalidateUser(user.id);
    setAuth(cookies, applied, rememberedSession(cookies));
    return redirect('/min-sida/edit-account/?saved=1', 303);
  }
  // The memoized users/me (name, email) is out of date now; a password change also retires the tokens.
  invalidateUser(user.id);
  if (patch.password) {
    // WordPress now refuses every token issued before the change (mos-account-api.php), this one
    // included: sign this browser in again with the new password, keeping its "Muna eftir mér" choice.
    let fresh = await requestToken(email, patch.password);
    if ('error' in fresh && fresh.error === 'unavailable') fresh = await requestToken(email, patch.password);
    if (!('token' in fresh)) {
      // Saved, but no new token: the old one is refused now, so say so instead of a silent sign-out.
      clearAuth(cookies);
      return redirect('/min-sida/?login=changed', 303);
    }
    setAuth(cookies, fresh.token, rememberedSession(cookies));
  }
  return redirect('/min-sida/edit-account/?saved=1', 303);
};
