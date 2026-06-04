// Max number of wishlist ids resolved in a single /api/products request. Shared so the server
// cap and the client agree: the API slices to this many (≤ ceil(N/100) Woo batches, bounding
// abuse of the ?ids= query), and WishlistView gone-checks ONLY these ids — items beyond the cap
// fall back to their stored snapshot instead of being mislabeled "Ekki í boði".
export const WISHLIST_MAX_IDS = 300;
