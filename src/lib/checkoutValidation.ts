// What the checkout form still lacks: the messages for the list above the form and the fields to mark.
// Pure, so the form can ask again on every render after a failed attempt (CheckoutForm.tsx).

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
  kennitala: string;
  needsShipping: boolean;
  rateChosen: boolean;
  needsPostbox: boolean;
  postboxChosen: boolean;
  needsPayment: boolean;
  paymentChosen: boolean;
  terms: boolean;
}

export interface CheckoutProblems {
  messages: string[];
  /** Ids of the inputs to mark, e.g. `billing_email`. */
  fields: Set<string>;
}

export function validateCheckout(s: CheckoutFormState): CheckoutProblems {
  const messages: string[] = [];
  const fields = new Set<string>();
  const requireFilled = (prefix: string, address: Record<string, string>, rules: FieldRule[], heading: string) => {
    for (const rule of rules) {
      if (rule.required && !(address[rule.key] ?? '').trim()) {
        messages.push(`${heading} ${rule.label} er nauðsynlegur reitur.`);
        fields.add(`${prefix}_${rule.key}`);
      }
    }
  };
  requireFilled('billing', s.billing, s.billingFields, 'Greiðsluupplýsingar');
  if (s.shipping) requireFilled('shipping', s.shipping, s.shippingFields, 'Sendingarupplýsingar');

  const email = (s.billing.email ?? '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    messages.push('Ógilt netfang.');
    fields.add('billing_email');
  }
  if (s.kennitala.trim() && s.kennitala.replace(/\D/g, '').length !== 10) {
    messages.push('Kennitala á að vera 10 tölustafir.');
    fields.add('billing_kennitala');
  }
  if (s.needsShipping && !s.rateChosen) messages.push('Veldu sendingarmáta.');
  if (s.needsPostbox && !s.postboxChosen) messages.push('Veldu póstbox fyrir sendinguna.');
  if (s.needsPayment && !s.paymentChosen) messages.push('Veldu greiðslumáta.');
  if (!s.terms) messages.push('Vinsamlegast lestu og samþykktu skilmálana til að halda áfram með pöntunina.');
  return { messages, fields };
}
