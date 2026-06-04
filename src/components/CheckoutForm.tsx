import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartLoading, ensureLoaded, resetCart, selectShipping, setCustomer } from '../lib/cartStore';
import { droppoint, rateNeedsPostbox } from '../lib/droppointStore';
import { formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import DroppointSelect from './DroppointSelect';
import CouponField from './CouponField';

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postcode: string;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address1: '',
  city: '',
  postcode: '',
};

// Display copy for the gateways the Store API exposes via cart.payment_methods.
// Order matters: card first (the IS market default), bank transfer second.
const PAYMENT_META: Record<string, { label: string; desc: string }> = {
  straumur: { label: 'Greiðslukort', desc: 'Visa · Mastercard — örugg greiðsla hjá Straumur.' },
  bacs: { label: 'Bankamillifærsla', desc: 'Greiðsluupplýsingar fylgja í staðfestingarpósti.' },
};
const PAYMENT_ORDER = ['straumur', 'bacs'];

export default function CheckoutForm() {
  const $cart = useStore(cart);
  const loading = useStore(cartLoading);
  const $droppoint = useStore(droppoint);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [addressDone, setAddressDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');

  useEffect(() => {
    ensureLoaded();
  }, []);

  const items = $cart?.items ?? [];
  const totals = $cart?.totals;
  const needsShipping = $cart?.needs_shipping ?? false;
  const needsPayment = $cart?.needs_payment ?? false;
  const rates = $cart?.shipping_rates?.[0]?.shipping_rates ?? [];
  const selectedRate = rates.find((r) => r.selected) ?? null;
  const cartPostcode = $cart?.shipping_address?.postcode ?? '';
  const needsPostbox = rateNeedsPostbox(selectedRate?.rate_id);
  const postboxChosen = needsPostbox && $droppoint != null && $droppoint.postcode === cartPostcode;

  // Drive the payment options from what the backend actually offers, known
  // gateways first. (cart.payment_methods had zero readers before this.)
  const availableMethods = $cart?.payment_methods ?? [];
  const orderedMethods = [
    ...PAYMENT_ORDER.filter((m) => availableMethods.includes(m)),
    ...availableMethods.filter((m) => !PAYMENT_ORDER.includes(m)),
  ];

  // Default to card (straumur) when offered, else the first available gateway.
  useEffect(() => {
    if (orderedMethods.length === 0) return;
    if (!orderedMethods.includes(paymentMethod)) {
      setPaymentMethod(orderedMethods.includes('straumur') ? 'straumur' : orderedMethods[0]);
    }
  }, [orderedMethods.join(',')]);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function addressObj() {
    return {
      first_name: form.firstName,
      last_name: form.lastName,
      address_1: form.address1,
      city: form.city,
      state: '',
      postcode: form.postcode,
      country: 'IS',
      phone: form.phone,
    };
  }

  function validate(): boolean {
    if (!form.firstName || !form.lastName || !form.email || !form.address1 || !form.city || !form.postcode) {
      setError('Vinsamlegast fylltu út alla nauðsynlega reiti.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      setError('Sláðu inn gilt netfang.');
      return false;
    }
    return true;
  }

  async function handleCalcShipping() {
    if (!validate()) return;
    try {
      await setCustomer({
        billing_address: { ...addressObj(), email: form.email },
        shipping_address: addressObj(),
      });
      setAddressDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Villa við útreikning sendingar.');
    }
  }

  async function handlePlaceOrder() {
    if (!validate()) return;
    if (items.length === 0) {
      setError('Karfan er orðin tóm.');
      return;
    }
    // Pósturinn "Pakki Póstbox" requires a chosen locker + phone number.
    const extra: Record<string, string> = {};
    if (needsPostbox) {
      if (!postboxChosen || !$droppoint) {
        setError('Veldu póstbox fyrir sendinguna.');
        return;
      }
      if (!form.phone.trim()) {
        setError('Símanúmer er nauðsynlegt fyrir afhendingu í póstbox.');
        return;
      }
      extra.postis_dpo_postbox = $droppoint.id;
      extra.postis_dpo_phonenumber = form.phone.trim();
    }
    // paymentMethod is required by canPlace whenever payment is needed; the fallbacks
    // only matter for a zero-total order (needs_payment=false) with no selectable gateway.
    const method = paymentMethod || orderedMethods[0] || 'bacs';
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billing_address: { ...addressObj(), email: form.email },
          shipping_address: addressObj(),
          payment_method: method,
          payment_data: [],
          ...extra,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.order_id) {
        throw new Error(data?.message || 'Ekki tókst að ganga frá pöntun.');
      }
      // Redirect gateways (e.g. Straumur hosted checkout) hand back a URL to send
      // the shopper to. The server-side cart is already emptied at order creation,
      // so we do NOT resetCart() here — just hand off and keep the button disabled.
      const redirectUrl = data.payment_result?.redirect_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      // Non-redirect gateways (bank transfer): straight to the local thank-you page. Pass the
      // id + key takk.astro actually reads, so the receipt resolves from the URL on refresh /
      // bookmark / share — not only from the one-shot mos_order cookie. Only append order_key when
      // present — never emit a literal `order_key=undefined`, which would fail the Woo lookup.
      resetCart();
      const okey = data.order_key ? `&order_key=${encodeURIComponent(data.order_key)}` : '';
      window.location.href = `/utskra/takk?order_id=${data.order_id}${okey}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ekki tókst að ganga frá pöntun.');
      setPlacing(false);
    }
  }

  if ($cart && items.length === 0 && !placing) {
    return (
      <div className="panel" style={{ textAlign: 'center', marginTop: '1rem' }}>
        <p className="muted" style={{ marginBottom: '1rem' }}>Karfan þín er tóm.</p>
        <a className="btn btn--accent" href="/verslun">Skoða vörur</a>
      </div>
    );
  }

  const canPlace =
    addressDone &&
    (!needsShipping || Boolean(selectedRate)) &&
    (!needsPostbox || (postboxChosen && form.phone.trim() !== '')) &&
    (!needsPayment || paymentMethod !== '') &&
    !placing &&
    items.length > 0;

  return (
    <div className="layout-2col" style={{ marginTop: '1rem' }}>
      <div>
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCalcShipping();
          }}
        >
          <h2>Afhendingarupplýsingar</h2>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="fn">Fornafn *</label>
              <input id="fn" aria-required="true" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} autoComplete="given-name" />
            </div>
            <div className="form-field">
              <label htmlFor="ln">Eftirnafn *</label>
              <input id="ln" aria-required="true" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} autoComplete="family-name" />
            </div>
            <div className="form-field">
              <label htmlFor="em">Netfang *</label>
              <input id="em" type="email" aria-required="true" value={form.email} onChange={(e) => update('email', e.target.value)} autoComplete="email" />
            </div>
            <div className="form-field">
              <label htmlFor="ph">Sími</label>
              <input id="ph" value={form.phone} onChange={(e) => update('phone', e.target.value)} autoComplete="tel" />
            </div>
            <div className="form-field full">
              <label htmlFor="ad">Heimilisfang *</label>
              <input id="ad" aria-required="true" value={form.address1} onChange={(e) => update('address1', e.target.value)} autoComplete="address-line1" />
            </div>
            <div className="form-field">
              <label htmlFor="pc">Póstnúmer *</label>
              <input id="pc" aria-required="true" value={form.postcode} onChange={(e) => update('postcode', e.target.value)} autoComplete="postal-code" />
            </div>
            <div className="form-field">
              <label htmlFor="ct">Staður *</label>
              <input id="ct" aria-required="true" value={form.city} onChange={(e) => update('city', e.target.value)} autoComplete="address-level2" />
            </div>
            <div className="form-field">
              <label htmlFor="co">Land</label>
              <input id="co" value="Ísland" readOnly disabled />
            </div>
          </div>
          <button type="submit" className="btn" style={{ marginTop: '1rem' }} disabled={loading}>
            {addressDone ? 'Uppfæra sendingu' : 'Reikna sendingu'}
          </button>
        </form>

        {addressDone && needsShipping && (
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h2>Sendingarmáti</h2>
            {rates.length === 0 ? (
              <p className="muted">Engir sendingarmöguleikar fundust fyrir þetta póstnúmer.</p>
            ) : (
              rates.map((r) => (
                <label className="radio-card" key={r.rate_id} style={{ marginBottom: '0.5rem' }}>
                  <input
                    type="radio"
                    name="shipping"
                    checked={r.selected}
                    onChange={async () => {
                      try {
                        await selectShipping(r.rate_id);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Villa við val á sendingu.');
                      }
                    }}
                  />
                  <span>
                    {decodeEntities(r.name)}
                    <br />
                    <small>{formatStoreMoney(r.price, r.currency_minor_unit)}</small>
                  </span>
                </label>
              ))
            )}
            {needsPostbox && cartPostcode && <DroppointSelect postcode={cartPostcode} />}
          </div>
        )}

        {addressDone && orderedMethods.length > 0 && (
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h2>Greiðslumáti</h2>
            {orderedMethods.map((m) => {
              const meta = PAYMENT_META[m] ?? { label: m, desc: '' };
              return (
                <label className="radio-card" key={m} style={{ marginBottom: '0.5rem' }}>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === m}
                    onChange={() => {
                      setPaymentMethod(m);
                      setError(null);
                    }}
                  />
                  <span>
                    {meta.label}
                    {meta.desc && (
                      <>
                        <br />
                        <small>{meta.desc}</small>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {error && <p className="form-error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}
      </div>

      <aside className="panel summary">
        <h2>Pöntun</h2>
        {items.map((it) => (
          <div className="summary__row" key={it.key}>
            <span>
              {decodeEntities(it.name)} × {it.quantity}
            </span>
            <span>{formatStoreMoney(it.totals.line_total, it.totals.currency_minor_unit)}</span>
          </div>
        ))}
        {totals && (
          <>
            <div className="summary__row">
              <span>Vörur</span>
              <span>{formatStoreMoney(totals.total_items, totals.currency_minor_unit)}</span>
            </div>
            {needsShipping && (
              <div className="summary__row">
                <span>Sending</span>
                <span>{selectedRate ? formatStoreMoney(totals.total_shipping ?? '0', totals.currency_minor_unit) : '—'}</span>
              </div>
            )}
            {totals.total_discount && totals.total_discount !== '0' && (
              <div className="summary__row summary__row--discount">
                <span>Afsláttur</span>
                <span>−{formatStoreMoney(totals.total_discount, totals.currency_minor_unit)}</span>
              </div>
            )}
            <div className="summary__row summary__row--total">
              <span>Samtals</span>
              <span>{formatStoreMoney(totals.total_price, totals.currency_minor_unit)}</span>
            </div>
          </>
        )}
        <CouponField />
        <button type="button" className="btn btn--accent btn--block btn--lg" style={{ marginTop: '1rem' }} disabled={!canPlace} onClick={handlePlaceOrder}>
          {placing ? 'Geng frá pöntun…' : 'Staðfesta pöntun'}
        </button>
        {!addressDone && <p className="form-note" style={{ marginTop: '0.5rem' }}>Fylltu út afhendingarupplýsingar og reiknaðu sendingu.</p>}
      </aside>
    </div>
  );
}
