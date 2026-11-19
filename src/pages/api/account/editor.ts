import type { APIRoute } from 'astro';
import { readAuthToken, verifiedUser } from '../../../lib/auth';
import { MEDIA_BASE_URL } from '../../../lib/img';
import { runtimeEnv } from '../../../lib/logger';

export const prerender = false;

// Whether the signed-in account is staff (may edit products), for the admin bar on cached pages
// (components/AdminBar.astro). Identity comes from WordPress through the httpOnly session cookie; signed out
// and a customer get the same `canEdit: false`. Never cached (lib/cachePolicy: /api/account/).
export const GET: APIRoute = async ({ cookies }) => {
  const token = readAuthToken(cookies);
  const user = token ? await verifiedUser(token) : null;
  // WordPress couldn't be asked: not an answer the browser may remember for the session.
  if (user === 'unavailable') return Response.json({ canEdit: false }, { status: 503, headers: { 'Retry-After': '30' } });
  if (!user?.canEditProducts) return Response.json({ canEdit: false });
  // WordPress's public origin, where wp-admin lives: the media host (MOS_MEDIA_BASE_URL), unless
  // MOS_WP_ADMIN_URL names another at run time (local development, where media comes from live).
  return Response.json({ canEdit: true, adminBase: runtimeEnv('MOS_WP_ADMIN_URL') || MEDIA_BASE_URL });
};
