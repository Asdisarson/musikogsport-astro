// Shared JSON Response builder for the /api/* routes. Replaces the local `json()` helper that
// was copy-pasted across order.ts / products.ts / droppoints.ts. The cart family uses its own
// respondCart()/badRequest() (those also rotate the Cart-Token), so this is for the non-cart routes.
export function jsonResponse(data: unknown, status: number, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}
