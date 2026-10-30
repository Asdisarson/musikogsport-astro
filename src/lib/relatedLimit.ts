import { createLimiter } from './rateLimit';

// The product page's related-products server island (components/RelatedProducts) is its own public URL, and each
// request fans out to WooCommerce and reads photos. Limited per visitor like /api/products: a shopper opens one
// product page at a time, so 60 a minute only stops a script replaying the island URL. Module scope, because a
// component's frontmatter runs on every render.
export const relatedRequests = createLimiter(60, 60 * 1000);
