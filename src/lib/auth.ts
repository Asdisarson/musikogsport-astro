// Customer sign-in for /min-sida/ — SERVER-ONLY. WordPress issues a JWT (jwt-authentication-for-wp-rest-api);
// it lives only in the httpOnly `mos_auth` cookie. Identity always comes from WordPress (`users/me` with
// the token), never from anything the browser sends. `mos_li` is a non-secret flag so cached pages can
// show "Mín síða" instead of "Innskráning" client-side.
import type { AstroCookies } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { createTtlMap } from './cache';
import { authStatus } from './http';

export const AUTH_COOKIE = 'mos_auth';
const FLAG_COOKIE = 'mos_li';
const REMEMBER_SECONDS = 7 * 24 * 60 * 60; // the plugin's token lifetime

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

/** A token, or why there is none: WordPress refused the credentials, or couldn't be asked. */
export type TokenResult = { token: string } | { error: 'rejected' | 'unavailable' };

async function askWordPress(path: string, init: RequestInit, timeoutMs: number): Promise<{ status: number | null; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`${WP_INTERNAL_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, data };
  } catch {
    return { status: null, data: null }; // transport failure or timeout
  }
}

const codeOf = (data: Record<string, unknown> | null) => (typeof data?.code === 'string' ? data.code : undefined);

/** Exchange a username/email + password for a token. The visitor only ever sees one generic failure
 *  message; 'unavailable' lets callers avoid counting a WordPress outage as a wrong password. */
export async function requestToken(username: string, password: string): Promise<TokenResult> {
  const { status, data } = await askWordPress(
    '/wp-json/jwt-auth/v1/token',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username, password }) },
    8000,
  );
  const token = typeof data?.token === 'string' ? data.token : '';
  const outcome = authStatus(status, codeOf(data));
  if (outcome === 'ok' && token) return { token };
  if (outcome === 'rejected') return { error: 'rejected' };
  console.warn(`[auth] token endpoint unavailable (${status ?? 'no answer'})`);
  return { error: 'unavailable' };
}

// Per-token memo of WordPress's users/me answer: a definite one for 15 s; no answer for 30 s and a fast
// error for 5 s (OUTAGE_MS / ERROR_MS). Concurrent checks of one token share a call. invalidateUser() makes
// older entries for that customer stale at once (sign-out, password change or reset in this process).
type Seen = AuthUser | null | 'unavailable';
const memo = createTtlMap<string, { user: Seen; at: number }>(2000);
const inflight = new Map<string, { promise: Promise<Seen>; asked: number }>();
// Tokens this process signed out: refused at once, and an answer that was already on its way can't
// memoize them as valid. After a minute WordPress's own denylist answers for them.
const revoked = createTtlMap<string, true>(2000);
const invalidatedAt = new Map<number, number>();
const MEMO_MS = 15 * 1000;
// No answer at all (a hang) is kept per token for 30 s, so each shopper waits for one 5 s timeout per 30 s
// rather than on every page view; a fast error (5xx, a firewall 403) only for 5 s. Per token: one
// visitor's cookie can't affect others.
const OUTAGE_MS = 30 * 1000;
const ERROR_MS = 5 * 1000;
// The JWT shape jwt-auth issues (base64url segments). Anything else can't be a token WordPress gave us.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function staleForUser(entry: { user: Seen; at: number }): boolean {
  const u = entry.user;
  return typeof u === 'object' && u !== null && (invalidatedAt.get(u.id) ?? -1) >= entry.at;
}

/** Forget every memoized session of this customer (in this process). */
export function invalidateUser(id: number): void {
  const t = Date.now();
  if (invalidatedAt.size > 1000) for (const [k, v] of invalidatedAt) if (t - v > MEMO_MS) invalidatedAt.delete(k);
  invalidatedAt.set(id, t);
}

async function checkToken(token: string): Promise<Seen> {
  // Stamped before asking, so an invalidateUser() during the call makes this answer stale.
  const asked = Date.now();
  const { status, data } = await askWordPress(
    '/wp-json/wp/v2/users/me?context=edit&_fields=id,name,email',
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    5000,
  );
  const outcome = authStatus(status, codeOf(data));
  let user: Seen = null;
  if (outcome === 'ok' && typeof data?.id === 'number' && data.id > 0) {
    user = { id: data.id, name: String(data.name ?? ''), email: String(data.email ?? '') };
  } else if (outcome !== 'rejected') {
    console.warn(`[auth] users/me unavailable (${status ?? 'no answer'}); keeping the session`);
    user = 'unavailable';
  }
  if (revoked.get(token)?.fresh) user = null;
  memo.set(token, { user, at: asked }, user !== 'unavailable' ? MEMO_MS : status === null ? OUTAGE_MS : ERROR_MS);
  return user;
}

function userForToken(token: string, fresh = false): Promise<Seen> {
  if (!TOKEN_SHAPE.test(token) || revoked.get(token)?.fresh) return Promise.resolve(null);
  if (!fresh) {
    const hit = memo.get(token);
    if (hit?.fresh && !staleForUser(hit.value)) return Promise.resolve(hit.value.user);
  }
  const pending = inflight.get(token);
  if (pending) {
    // Joining a check that started before this customer was invalidated: its answer is stale, ask again.
    return pending.promise.then((user) =>
      typeof user === 'object' && user !== null && (invalidatedAt.get(user.id) ?? -1) >= pending.asked ? checkToken(token) : user,
    );
  }
  const entry = {
    asked: Date.now(),
    promise: checkToken(token).finally(() => {
      if (inflight.get(token) === entry) inflight.delete(token); // never another call's entry
    }),
  };
  inflight.set(token, entry);
  return entry.promise;
}

/** WordPress's answer for a token without touching cookies (for work after the response). `fresh` skips
 *  the memo. */
export function verifiedUser(token: string, fresh = false): Promise<Seen> {
  return userForToken(token, fresh);
}

export function readAuthToken(cookies: AstroCookies): string | null {
  return cookies.get(AUTH_COOKIE)?.value || null;
}

/** The signed-in customer, or null. The cookie is dropped when WordPress refuses the token (expired or
 *  revoked) or it isn't token-shaped; while WordPress is down the visitor just looks signed out. */
export async function currentUser(cookies: AstroCookies): Promise<AuthUser | null> {
  const token = readAuthToken(cookies);
  if (!token) return null;
  const user = await userForToken(token);
  if (user === 'unavailable') return null;
  if (!user) clearAuth(cookies);
  return user;
}

/** Revoke a token in WordPress (mos/v1/account/logout denylists it until it expires). Best effort: the
 *  cookie is cleared either way. */
export async function revokeToken(token: string): Promise<void> {
  if (!TOKEN_SHAPE.test(token)) return; // not a token WordPress issued: nothing to revoke
  const known = memo.get(token)?.value.user;
  const signedIn = typeof known === 'object' && known !== null;
  if (signedIn) revoked.set(token, true, 60 * 1000); // refuse at once, before WordPress answers
  const { status, data } = await askWordPress(
    '/wp-json/mos/v1/account/logout',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    5000,
  );
  // 'rejected' = WordPress already refuses the token (expired or revoked). An outage, a firewall 403 or any
  // other answer leaves it alive in WordPress, so say so.
  if (authStatus(status, codeOf(data)) === 'unavailable') console.warn(`[auth] token revoke failed -> ${status ?? 'no answer'}`);
  // Recorded only for a token this process knew or WordPress just signed out (2xx), so junk-but-token-shaped
  // logouts can't push real sessions out of the bounded maps. If WordPress didn't take the logout, the token
  // is refused here for a minute only, and stays valid in WordPress (logged above).
  if (signedIn || (status !== null && status >= 200 && status < 300)) {
    revoked.set(token, true, 60 * 1000);
    inflight.delete(token);
    memo.set(token, { user: null, at: Date.now() }, MEMO_MS);
  }
  if (signedIn) invalidateUser(known.id);
}

export function setAuth(cookies: AstroCookies, token: string, remember: boolean): void {
  const secure = import.meta.env.PROD;
  const maxAge = remember ? REMEMBER_SECONDS : undefined; // session cookie unless "Muna eftir mér"
  cookies.set(AUTH_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge });
  // The flag's value remembers the "Muna eftir mér" choice, so a re-issued token keeps it.
  cookies.set(FLAG_COOKIE, remember ? 'r' : '1', { path: '/', httpOnly: false, sameSite: 'lax', secure, maxAge });
}

/** Whether this browser chose "Muna eftir mér" when it signed in. */
export function rememberedSession(cookies: AstroCookies): boolean {
  return cookies.get(FLAG_COOKIE)?.value === 'r';
}

export function clearAuth(cookies: AstroCookies): void {
  cookies.delete(AUTH_COOKIE, { path: '/' });
  cookies.delete(FLAG_COOKIE, { path: '/' });
}
