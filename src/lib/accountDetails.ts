// Saving /min-sida/edit-account/: name, e-mail and an optional password change, which needs the current password.
import type { AstroCookies } from 'astro';
import { clearAuth, invalidateUser, rememberedSession, requestToken, setAuth, verifiedUser, type AuthUser } from './auth';
import { updateCustomer } from './account';
import { detailsProblems, WRONG_CURRENT_PASSWORD, type DetailsField, type DetailsInput } from './accountFormat';
import { createLimiter } from './rateLimit';

/** Where to send the customer after a save, or why nothing was saved: per field, or as one notice. */
export type DetailsOutcome = { redirect: string } | { problems: Map<DetailsField, string> } | { notice: string };

const SAVED = '/min-sida/edit-account/?saved=1';

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

export async function saveDetails(user: AuthUser, cookies: AstroCookies, d: DetailsInput): Promise<DetailsOutcome> {
  const problems = detailsProblems(d);
  if (problems.size > 0) return { problems };

  const patch: Record<string, string> = { first_name: d.first, last_name: d.last, email: d.email };
  if (d.next) {
    const customer = String(user.id);
    if (!wrongPasswords.take(customer)) {
      console.warn(`[account] customer ${customer} hit the wrong-password limit on edit-account`);
      return { notice: 'Of margar tilraunir. Reyndu aftur síðar.' };
    }
    const check = await requestToken(user.email, d.current);
    if ('error' in check) {
      if (check.error === 'rejected') return { problems: new Map([['password_current', WRONG_CURRENT_PASSWORD]]) };
      wrongPasswords.refund(customer);
      return { notice: 'Ekki tókst að staðfesta lykilorðið: þjónustan svaraði ekki. Reyndu aftur eftir smá stund.' };
    }
    wrongPasswords.refund(customer);
    patch.password = d.next;
  }
  try {
    await updateCustomer(user.id, patch);
  } catch (err) {
    // WooCommerce refused the change (an email already in use, an invalid field): nothing was saved.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.warn(`[account] customer ${user.id}: details not saved: ${err instanceof Error ? err.message : String(err)}`);
    if (!timedOut || !patch.password) return { notice: 'Ekki tókst að vista breytingarnar. Reyndu aftur.' };
    // A timeout can come after WooCommerce applied the change. If the new credentials sign this customer
    // in, it did.
    const applied = await ownToken(user.id, d.email, patch.password);
    // Not yet applied, but a timed-out save may still finish: say so rather than "not saved".
    if (!applied) {
      console.warn(`[account] customer ${user.id}: password change timed out and is not confirmed`);
      return { notice: 'Ekki fékkst staðfesting á vistuninni. Ef þú verður skráð(ur) út skaltu skrá þig inn með nýja lykilorðinu.' };
    }
    invalidateUser(user.id);
    setAuth(cookies, applied, rememberedSession(cookies));
    return { redirect: SAVED };
  }
  // The memoized users/me (name, email) is out of date now; a password change also retires the tokens.
  invalidateUser(user.id);
  if (patch.password) {
    // WordPress now refuses every token issued before the change (mos-account-api.php), this one
    // included: sign this browser in again with the new password, keeping its "Muna eftir mér" choice.
    let fresh = await requestToken(d.email, patch.password);
    if ('error' in fresh && fresh.error === 'unavailable') fresh = await requestToken(d.email, patch.password);
    if (!('token' in fresh)) {
      // Saved, but no new token: the old one is refused now, so say so instead of a silent sign-out.
      console.warn(`[account] customer ${user.id}: password changed, but no new token came; signed out`);
      clearAuth(cookies);
      return { redirect: '/min-sida/?login=changed' };
    }
    setAuth(cookies, fresh.token, rememberedSession(cookies));
  }
  return { redirect: SAVED };
}
