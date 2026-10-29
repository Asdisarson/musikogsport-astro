// Receipt amounts for a WooCommerce order (client-safe, pure). WooCommerce's own receipt lists each line
// at its pre-coupon `subtotal`, then one "Afsláttur" row, so the coupon is subtracted exactly once. Line
// `total` is already discounted and must not be paired with `discount_total`. Amounts include tax,
// as the storefront shows prices.

interface MoneyLine {
  name?: string;
  quantity?: number;
  subtotal?: string;
  subtotal_tax?: string;
}

interface ShippingLine {
  method_title?: string;
  total?: string;
  total_tax?: string;
}

export interface RawOrderMoney {
  discount_total?: string;
  discount_tax?: string;
  line_items?: MoneyLine[];
  shipping_lines?: ShippingLine[];
}

export interface OrderAmounts {
  items: { name: string; quantity: number; total: string }[];
  shipping: { title: string; total: string }[];
  /** Sum of the line amounts (before the coupon). */
  subtotal: number;
  /** Coupon discount incl. tax, as a positive number. */
  discount: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export function orderAmounts(o: RawOrderMoney): OrderAmounts {
  const items = (o.line_items ?? []).map((li) => ({
    name: String(li.name ?? ''),
    quantity: num(li.quantity),
    total: String(num(li.subtotal) + num(li.subtotal_tax)),
  }));
  return {
    items,
    shipping: (o.shipping_lines ?? []).map((s) => ({
      title: String(s.method_title ?? ''),
      total: String(num(s.total) + num(s.total_tax)),
    })),
    subtotal: items.reduce((sum, i) => sum + Number(i.total), 0),
    discount: num(o.discount_total) + num(o.discount_tax),
  };
}
