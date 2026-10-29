import type { APIRoute } from 'astro';
import { clearAuth, readAuthToken, revokeToken } from '../../../lib/auth';
import { sameOrigin } from '../../../lib/http';
import { clearOrderCookie, clearToken } from '../../../lib/cartProxy';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  // Revoke in WordPress too, so a copied cookie stops working now rather than when the token expires.
  const token = readAuthToken(cookies);
  if (token) await revokeToken(token);
  clearAuth(cookies);
  // The cart (its Store API session holds the addresses typed at checkout) and the last order's receipt cookie go
  // too, as WooCommerce drops its session on logout: the next person on a shared device starts clean (LM-04).
  clearToken({ cookies });
  clearOrderCookie({ cookies });
  return redirect('/min-sida/', 303);
};
