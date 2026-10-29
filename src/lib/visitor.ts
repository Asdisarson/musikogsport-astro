// The visitor's rate-limit key — SERVER-ONLY. Behind a reverse proxy Astro's clientAddress is the proxy (or,
// with security.allowedDomains, possibly a client-chosen X-Forwarded-For entry), so the key comes from the
// edge's client-IP header when MOS_CLIENT_IP_HEADER names one (App Platform: do-connecting-ip), otherwise
// from X-Forwarded-For, trusting only MOS_TRUSTED_PROXY_HOPS hops (lib/http visitorIp).
import { MOS_CLIENT_IP_HEADER, MOS_TRUSTED_PROXY_HOPS } from 'astro:env/server';
import { visitorIp } from './http';

export function visitorKey(ctx: { request: Request; clientAddress: string }): string {
  const edgeIp = MOS_CLIENT_IP_HEADER ? ctx.request.headers.get(MOS_CLIENT_IP_HEADER) : null;
  return visitorIp(ctx.request.headers.get('x-forwarded-for'), ctx.clientAddress, MOS_TRUSTED_PROXY_HOPS, edgeIp);
}
