// Shared types for the WooCommerce REST v3 catalog + Store API cart/checkout.

export type StockStatus = 'instock' | 'outofstock' | 'onbackorder';
export type ProductType = 'simple' | 'variable' | 'grouped' | 'external';

export interface WooImage {
  id?: number;
  src: string;
  alt?: string;
  name?: string;
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
  attributes?: WooAttribute[];
  variations?: number[]; // variation IDs only
  related_ids?: number[];
}

export interface WooVariationAttr {
  id: number;
  name: string;
  slug?: string;
  option: string;
}

export interface WooVariation {
  id: number;
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

export type ProductOrderBy = 'date' | 'price' | 'popularity' | 'title' | 'rating' | 'menu_order';

export interface ProductQuery {
  page?: number;
  per_page?: number;
  category?: number; // numeric ID (resolve slug -> id first)
  search?: string;
  orderby?: ProductOrderBy;
  order?: 'asc' | 'desc';
  on_sale?: boolean;
  stock_status?: StockStatus;
  featured?: boolean;
  include?: number[];
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

export interface CheckoutPayload {
  billing_address: Address;
  shipping_address?: Omit<Address, 'email'>;
  payment_method: string;
  payment_data?: { key: string; value: string }[];
  customer_note?: string;
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

/** Store API error body shape. */
export interface StoreError {
  code: string;
  message: string;
  data?: { status?: number; [k: string]: unknown };
}
