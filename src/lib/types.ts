// Shared types for the WooCommerce REST v3 catalog + Store API cart/checkout.
import type { CardFill } from './photoBg';

export type StockStatus = 'instock' | 'outofstock' | 'onbackorder';
export type ProductType = 'simple' | 'variable' | 'grouped' | 'external';

export interface WooImage {
  id?: number;
  src: string;
  alt?: string;
  name?: string;
  /** WC REST v3 (this store): the attachment's sub-sizes; `false` when WordPress made none. */
  srcset?: string | false;
  /** Store API: WordPress's own `sizes` for the full-width image (the cards pass their own instead). */
  sizes?: string;
  /** WC REST v3 and the Store API: the 450×450 catalog crop. */
  thumbnail?: string;
}

export interface WooCategoryRef {
  id: number;
  name: string;
  slug: string;
}

export interface WooAttribute {
  id: number;
  name: string;
  position?: number;
  visible: boolean;
  variation: boolean;
  options: string[];
}

/** Product as returned by GET /products (full or _fields-trimmed). */
export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  type: ProductType;
  status?: string;
  permalink?: string;
  sku?: string;
  description?: string;
  short_description?: string;
  price: string; // whole-ISK string, e.g. "37990". Variable parents = min variation price (NON-empty here), with regular_price/sale_price blank — verified against this store's WC REST v3.
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  price_html?: string;
  stock_status: StockStatus;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  purchasable?: boolean;
  images: WooImage[];
  categories: WooCategoryRef[];
  tags?: WooCategoryRef[];
  brands?: WooCategoryRef[];
  weight?: string;
  dimensions?: { length: string; width: string; height: string };
  attributes?: WooAttribute[];
  variations?: number[]; // variation IDs only
  related_ids?: number[];
  /** The shop's hand-picked linked products ("Tengdar vörur"): upsells and cross-sells. Full product only. */
  upsell_ids?: number[];
  cross_sell_ids?: number[];
}

export interface WooVariationAttr {
  id: number;
  name: string;
  slug?: string;
  option: string;
}

export interface WooVariation {
  id: number;
  menu_order?: number;
  attributes: WooVariationAttr[];
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock_status: StockStatus;
  stock_quantity?: number | null;
  image?: WooImage | null;
  purchasable?: boolean;
  sku?: string;
}

export interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description?: string;
  count: number;
  image?: WooImage | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  totalPages: number;
  page: number;
}

// ---------- Store API (cart / checkout) ----------

/** Currency descriptor embedded in every Store API monetary block. */
export interface StoreCurrency {
  currency_code: string;
  currency_symbol: string;
  currency_minor_unit: number;
  currency_decimal_separator: string;
  currency_thousand_separator: string;
  currency_prefix: string;
  currency_suffix: string;
}

export interface CartItemPrices extends StoreCurrency {
  price: string;
  regular_price: string;
  sale_price: string;
}

export interface CartItem {
  key: string;
  id: number;
  quantity: number;
  name: string;
  short_description?: string;
  permalink?: string;
  images: WooImage[];
  variation: { attribute: string; value: string }[];
  prices: CartItemPrices;
  totals: StoreCurrency & {
    line_total: string;
    line_subtotal: string;
    line_subtotal_tax?: string;
    line_total_tax?: string;
  };
}

export interface ShippingRateOption {
  rate_id: string; // "{method_id}:{instance_id}"
  name: string;
  price: string;
  method_id: string;
  instance_id: number;
  currency_minor_unit: number;
  selected: boolean;
}

export interface ShippingPackage {
  package_id: number | string;
  name: string;
  destination?: Record<string, string>;
  shipping_rates: ShippingRateOption[];
}

export interface CartTotals extends StoreCurrency {
  total_items: string;
  total_items_tax?: string;
  total_price: string;
  total_shipping?: string;
  total_tax?: string;
  total_discount?: string;
}

export interface CartCoupon {
  code: string;
  discount_type?: string;
  totals?: Partial<StoreCurrency> & {
    total_discount: string;
    total_discount_tax?: string;
  };
}

export interface Address {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state?: string;
  postcode: string;
  country: string;
  phone?: string;
  email?: string; // billing only
}

export interface Cart {
  items: CartItem[];
  items_count: number;
  coupons: CartCoupon[];
  needs_payment: boolean;
  needs_shipping: boolean;
  has_calculated_shipping: boolean;
  shipping_rates: ShippingPackage[];
  shipping_address: Partial<Address>;
  billing_address: Partial<Address>;
  totals: CartTotals;
  payment_methods: string[];
  errors: unknown[];
}

/** A Store API checkout address as /api/checkout forwards it (lib/checkoutPayload): every field a string. */
export type CheckoutAddress = Required<Omit<Address, 'email'>>;

/** The checkout body /api/checkout forwards to the Store API: only these fields (LM-03, lib/checkoutPayload). */
export interface CheckoutPayload {
  billing_address: CheckoutAddress & { email: string };
  shipping_address?: CheckoutAddress;
  /** Absent for a free order (CO-21). */
  payment_method?: string;
  payment_data: { key: string; value: string }[];
  customer_note: string;
  // Pósturinn "Pakki Póstbox" pickup: the chosen locker id + a contact phone. The Pósturinn
  // plugin's own Store-API checkout hook reads these top-level fields off the request (see the
  // NOTE in wp-mu-plugins/mos-posturinn-droppoints.php).
  postis_dpo_postbox?: string;
  postis_dpo_phonenumber?: string;
  // Live's extra checkout fields, saved by wp-mu-plugins/mos-checkout-fields.php as `_billing_ssn` / `skiptimidi`,
  // and the checkout attempt id it stores as `_mos_checkout_attempt` (LM-01).
  extensions: {
    mos: { kennitala: string | null; skiptimidi: boolean; attempt?: string };
    /** The visit's origin for WooCommerce's order attribution (lib/origin), plus the server's `user_agent`. */
    'woocommerce/order-attribution'?: Record<string, string>;
  };
}

export interface OrderResult {
  order_id: number;
  status: string;
  order_key: string;
  order_number: string;
  customer_note?: string;
  payment_result?: {
    payment_status: 'success' | 'pending' | 'failure' | 'error';
    redirect_url?: string;
    payment_details?: { key: string; value: string }[];
  };
}

/** Trimmed product fields for a card (grid / wishlist). Matches the /api/products response body. */
export interface ProductSummary {
  id: number;
  slug: string;
  /** Storefront product URL (live /verslun/<category path>/<slug>/ shape). */
  path: string;
  name: string;
  image: string;
  /** The image's sub-sizes on the media host (mediaSrcset), so the card loads a small candidate. */
  srcset?: string;
  /** How the card tile fills the gap around the image (lib/photoBg cardFill) when already known; absent: no fill. */
  photoFill?: CardFill;
  priceText?: string;
  onSale?: boolean;
  outOfStock?: boolean;
  /** The card subtitle: the product's first card category (cardCategories). */
  subtitle?: string;
  /** Struck original price when discounted (simple products; variable ones show only "-N%"). */
  wasText?: string;
  /** Discount for the green "-N%" (salePercent). */
  percent?: number;
}

/** Trimmed variation shape consumed by the PDP purchase island (a subset of WooVariation). */
export interface PdpVariation {
  id: number;
  attributes: { name: string; option: string }[];
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  /** Never set on the page: stock is not baked in. It comes from /api/live/product (lib/liveStore). */
  stock_status?: string;
  sku?: string;
  image?: { src: string; alt: string } | null;
}

/** One attribute facet: a taxonomy + the term IDs selected within it (OR'd together). */
export interface AttributeFilter {
  taxonomy: string; // e.g. "pa_litur"
  termIds: number[];
}
