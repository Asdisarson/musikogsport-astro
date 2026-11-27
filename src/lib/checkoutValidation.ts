// What the checkout form still lacks. Each message is keyed by the place it is shown: an input's id
// (`billing_email`), or `shipping_method`, `postbox`, `payment_method`, `terms`. Pure, so the form can ask again
// on every render after a failed attempt (CheckoutForm.tsx).

interface FieldRule {
  key: string;
  label: string;
  required?: boolean;
}

export interface CheckoutFormState {
  billing: Record<string, string>;
  billingFields: FieldRule[];
  /** The other delivery address, or null when the order goes to the billing address. */
  shipping: Record<string, string> | null;
  shippingFields: FieldRule[];
  nationalId: string;
  needsShipping: boolean;
  rateChosen: boolean;
  needsPostbox: boolean;
  postboxChosen: boolean;
  needsPayment: boolean;
  paymentChosen: boolean;
  terms: boolean;
}

/** Where a message goes → the message, in the order the form shows them. */
export type CheckoutProblems = Map<string, string>;

export function validateCheckout(s: CheckoutFormState): CheckoutProblems {
  const problems: CheckoutProblems = new Map();
  const requireFilled = (prefix: string, address: Record<string, string>, rules: FieldRule[]) => {
    for (const rule of rules) {
      if (rule.required && !(address[rule.key] ?? '').trim()) problems.set(`${prefix}_${rule.key}`, `${rule.label} er nauðsynlegur reitur.`);
    }
  };
  requireFilled('billing', s.billing, s.billingFields);
  if (s.nationalId.trim() && s.nationalId.replace(/\D/g, '').length !== 10) problems.set('billing_national_id', 'Kennitala á að vera 10 tölustafir.');
  const email = (s.billing.email ?? '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) problems.set('billing_email', 'Ógilt netfang.');
  if (s.shipping) requireFilled('shipping', s.shipping, s.shippingFields);

  if (s.needsShipping && !s.rateChosen) problems.set('shipping_method', 'Veldu sendingarmáta.');
  if (s.needsPostbox && !s.postboxChosen) problems.set('postbox', 'Veldu póstbox fyrir sendinguna.');
  if (s.needsPayment && !s.paymentChosen) problems.set('payment_method', 'Veldu greiðslumáta.');
  if (!s.terms) problems.set('terms', 'Samþykktu skilmálana til að halda áfram með pöntunina.');
  return problems;
}
