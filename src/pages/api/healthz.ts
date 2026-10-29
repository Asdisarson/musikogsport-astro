import type { APIRoute } from 'astro';

export const prerender = false;

// Liveness for the App Platform health check (.do/app.yaml): the Node process is up and serving. No upstream
// calls — a WordPress outage must not get healthy instances restarted (pages already degrade on their own).
// Under /api/ so the trailing-slash middleware leaves it alone and robots.txt already disallows it.
export const GET: APIRoute = () =>
  new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
