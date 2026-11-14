// How the checkout presents the payment gateways the Store API offers. Pure, so the copy and the default choice are
// tested without the form (CheckoutForm.tsx).

export interface PaymentMeta {
  label: string;
  desc: string;
  /** Show the card logos beside the label. */
  cards?: boolean;
}

const CARD: PaymentMeta = { label: 'Greiðslukort', desc: 'Gera upp með kreditkorti', cards: true };

// Either card gateway reads the same to the shopper: Straumur (what the storefront was built for) and Valitor (the
// gateway live WordPress runs, whose own title is the bare id "valitor").
const META: Record<string, PaymentMeta> = {
  straumur: CARD,
  valitor: CARD,
  bacs: { label: 'Bankamillifærsla', desc: 'Greiðsluupplýsingar fylgja í staðfestingarpósti.' },
};
const CARD_GATEWAYS = ['straumur', 'valitor'];
const ORDER = [...CARD_GATEWAYS, 'bacs'];

/** Whether the gateway takes a card on its own page; the payment is confirmed to WordPress afterwards. */
export function isCardGateway(method: string): boolean {
  return CARD_GATEWAYS.includes(method);
}

/** A gateway's label, description and logos; one the checkout has no copy for shows its id. */
export function paymentMeta(method: string): PaymentMeta {
  return META[method] ?? { label: method, desc: '' };
}

/** The offered gateways in display order: cards, the bank transfer, then any other as the Store API listed it. */
export function orderPaymentMethods(available: readonly string[]): string[] {
  return [...ORDER.filter((m) => available.includes(m)), ...available.filter((m) => !ORDER.includes(m))];
}

/** The gateway chosen for the shopper: a card gateway when one is offered, else the first; '' when none is. */
export function defaultPaymentMethod(methods: readonly string[]): string {
  return CARD_GATEWAYS.find((m) => methods.includes(m)) ?? methods[0] ?? '';
}
