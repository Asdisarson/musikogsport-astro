import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartLoading, ensureLoaded, resetCart, selectShipping, setCustomer, cartError, withCartLock } from '../lib/cartStore';
import { droppoint, postboxReady, rateNeedsPostbox, verifiedDroppoint } from '../lib/droppointStore';
import { formatISK, formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import { MEDIA_BASE_URL } from '../lib/img';
import { cartSubtotal, cartViewState, lineSubtotal, variationText } from '../lib/cartView';
import { CHECKING_MESSAGE, addressFor, checkoutBody, pollCheckoutStatus, submitCheckout, type FormAddress } from '../lib/checkoutFlow';
import { newAttemptId } from '../lib/attemptId';
import { validateCheckout, type CheckoutProblems } from '../lib/checkoutValidation';
import { CHECKOUT_CLIENT_TIMEOUT_MS } from '../lib/timeouts';
import { onPageRestored } from '../lib/pageLifecycle';
import { CartLoadError, LineImage } from './CartParts';
import { defaultPaymentMethod, orderPaymentMethods, paymentMeta } from '../lib/paymentMethods';
import DroppointSelect from './DroppointSelect';
import CouponField, { CouponRows } from './CouponField';

// The checkout (WooCommerce classic, distraction-free; nike-look): billing fields with their labels above on the
// left, "Þín pöntun" (the cart summary's anatomy), the discount code, payment and "Panta" on the right. Fields use
// Woo's form-row-first/last/wide floats, paired as Kennitala + company and Póstnúmer + Borg / Bær.
// The order review re-quotes Pósturinn shipping once the address is complete, like Woo's
// update_order_review.

type Width = 'first' | 'last' | 'wide';
type Address = FormAddress;
interface FieldDef {
  key: keyof Address;
  label: string;
  width: Width;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric' | 'tel' | 'email';
}

const EMPTY: Address = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', postcode: '', city: '', phone: '', email: '' };

// Live's field order (WooCommerce Checkout Field Editor config); widths pair related fields.
const BILLING_BEFORE_COUNTRY: FieldDef[] = [
  { key: 'first_name', label: 'Eiginnafn', width: 'first', required: true, autoComplete: 'given-name' },
  { key: 'last_name', label: 'Eftirnafn', width: 'last', required: true, autoComplete: 'family-name' },
];
const BILLING_AFTER_COUNTRY: FieldDef[] = [
  { key: 'address_1', label: 'Heimilisfang', width: 'wide', required: true, autoComplete: 'address-line1' },
  { key: 'address_2', label: 'Íbúð, hæð o.fl.', width: 'wide', autoComplete: 'address-line2' },
  { key: 'postcode', label: 'Póstnúmer', width: 'first', required: true, inputMode: 'numeric', autoComplete: 'postal-code' },
  { key: 'city', label: 'Borg / Bær', width: 'last', required: true, autoComplete: 'address-level2' },
  { key: 'phone', label: 'Sími', width: 'wide', required: true, type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  { key: 'email', label: 'Netfang', width: 'wide', required: true, type: 'email', inputMode: 'email', autoComplete: 'email' },
];
const SHIPPING_FIELDS: FieldDef[] = [
  { key: 'first_name', label: 'Eiginnafn', width: 'first', required: true, autoComplete: 'shipping given-name' },
  { key: 'last_name', label: 'Eftirnafn', width: 'last', required: true, autoComplete: 'shipping family-name' },
  { key: 'company', label: 'Nafn fyrirtækis', width: 'wide', autoComplete: 'shipping organization' },
  { key: 'address_1', label: 'Heimilisfang', width: 'wide', required: true, autoComplete: 'shipping address-line1' },
  { key: 'address_2', label: 'Íbúð, hæð o.fl.', width: 'wide', autoComplete: 'shipping address-line2' },
  { key: 'postcode', label: 'Póstnúmer', width: 'first', required: true, inputMode: 'numeric', autoComplete: 'shipping postal-code' },
  { key: 'city', label: 'Borg / Bær', width: 'last', required: true, autoComplete: 'shipping address-level2' },
];

/** A problem with one part of the form, shown right at that part (small text). */
function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span className="field-error" id={id}>
      {message}
    </span>
  );
}

function FloatField({
  id,
  def,
  value,
  error,
  onChange,
}: {
  id: string;
  def: Omit<FieldDef, 'key'>;
  value: string;
  /** What is wrong with the value, shown under the input. */
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <p
      className={`form-row form-row-${def.width}${value ? ' has-val' : ''}${error ? ' is-invalid' : ''}`}
      id={`${id}_field`}
    >
      <input
        id={id}
        className="input-text"
        type={def.type ?? 'text'}
        value={value}
        inputMode={def.inputMode}
        autoComplete={def.autoComplete}
        aria-required={def.required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}_error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <label htmlFor={id}>
        {def.label}
        {def.required ? <abbr className="required" title="nauðsynlegt"> *</abbr> : <span className="optional"> (valfrjálst)</span>}
      </label>
      {error && <FieldError id={`${id}_error`} message={error} />}
    </p>
  );
}

function CountryField({ id, width }: { id: string; width: Width }) {
  return (
    <p className={`form-row form-row-${width} has-val`} id={`${id}_field`}>
      <select id={id} className="input-text" value="IS" onChange={() => {}} aria-required="true">
        <option value="IS">Ísland</option>
      </select>
      <label htmlFor={id}>
        Land<abbr className="required" title="nauðsynlegt">*</abbr>
      </label>
    </p>
  );
}

const CardLogos = () => (
  <span className="pay-logos" aria-hidden="true">
    <svg viewBox="0 0 48 16" width="42" height="14"><text x="0" y="13" fontFamily="Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="15" fill="#1a1f71">VISA</text></svg>
    <svg viewBox="0 0 32 20" width="30" height="19"><circle cx="11" cy="10" r="9" fill="#eb001b" /><circle cx="21" cy="10" r="9" fill="#f79e1b" fillOpacity="0.9" /></svg>
    <svg viewBox="0 0 32 20" width="30" height="19"><circle cx="11" cy="10" r="9" fill="#0099df" /><circle cx="21" cy="10" r="9" fill="#e60012" fillOpacity="0.85" /></svg>
  </span>
);

export default function CheckoutForm({ status = '', initialBilling, signedIn = false }: { status?: string; initialBilling?: Partial<Record<keyof Address, string>>; signedIn?: boolean }) {
  const $cart = useStore(cart);
  const loading = useStore(cartLoading);
  const $droppoint = useStore(droppoint);
  const $verifiedDroppoint = useStore(verifiedDroppoint);
  // A signed-in customer starts from their saved billing address, as with WooCommerce.
  const [billing, setBilling] = useState<Address>(() => {
    const start = { ...EMPTY };
    for (const k of Object.keys(EMPTY) as (keyof Address)[]) if (typeof initialBilling?.[k] === 'string') start[k] = initialBilling[k]!;
    return start;
  });
  const [shipping, setShipping] = useState<Address>(EMPTY);
  const [shipDiff, setShipDiff] = useState(false);
  const [kennitala, setKennitala] = useState('');
  const [skiptimidi, setSkiptimidi] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  // Failed re-quotes and shipping-rate changes land in the shared cartError; show them with the
  // order errors (coupon errors stay inline under the coupon field).
  const cartErr = useStore(cartError);
  // Once an order attempt has been made the form is checked again on every render, so the message under a field
  // and its red frame go away the moment the shopper fixes it, not at the next press of „Panta".
  const [attempted, setAttempted] = useState(false);
  const [placing, setPlacing] = useState(false);
  // While the page asks whether an order whose answer was lost went through (LM-01).
  const [checking, setChecking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastQuote = useRef('');
  // The debounced re-quote waiting to fire, if any (Panta runs it at once instead).
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ensureLoaded();
  }, []);

  // Back from the payment page can restore this page from the back/forward cache exactly as it was left: "Panta"
  // disabled mid-order. Make it usable again (CO-04); the cart store re-reads the cart itself (CO-05).
  useEffect(
    () =>
      onPageRestored(() => {
        setPlacing(false);
        setChecking(false);
      }),
    [],
  );

  const items = $cart?.items ?? [];
  const totals = $cart?.totals;
  const minor = totals?.currency_minor_unit ?? 0;
  const needsShipping = $cart?.needs_shipping ?? false;
  const needsPayment = $cart?.needs_payment ?? false;
  const rates = $cart?.shipping_rates?.[0]?.shipping_rates ?? [];
  const selectedRate = rates.find((r) => r.selected) ?? null;
  const cartPostcode = $cart?.shipping_address?.postcode ?? '';
  const needsPostbox = rateNeedsPostbox(selectedRate?.rate_id);
  // A locker chosen for this postcode and confirmed in Pósturinn's current list (CO-03).
  const postboxChosen = needsPostbox && postboxReady($droppoint, $verifiedDroppoint, cartPostcode);
  const ship = shipDiff ? shipping : billing;

  const available = $cart?.payment_methods ?? [];
  const methods = orderPaymentMethods(available);
  useEffect(() => {
    if (methods.length && !methods.includes(paymentMethod)) setPaymentMethod(defaultPaymentMethod(methods));
  }, [methods.join(',')]);

  // An empty cart can't check out — live bounces to /karfa/ (unless we're showing a payment notice).
  useEffect(() => {
    if ($cart && items.length === 0 && !placing && !status) window.location.replace('/karfa/');
  }, [$cart, items.length, placing, status]);

  // Re-quote shipping once the delivery address is complete (debounced, only when it changed).
  useEffect(() => {
    if (!needsShipping || !/^\d{3}$/.test(ship.postcode.trim()) || !ship.address_1.trim() || !ship.city.trim()) return;
    const signature = JSON.stringify([ship.address_1, ship.postcode, ship.city].map((s) => s.trim()));
    if (signature === lastQuote.current) return;
    const t = setTimeout(() => {
      quoteTimer.current = null;
      lastQuote.current = signature;
      void setCustomer({ shipping_address: addressFor(ship, billing.phone) }).catch(() => {
        lastQuote.current = '';
      });
    }, 600);
    quoteTimer.current = t;
    return () => {
      clearTimeout(t);
      if (quoteTimer.current === t) quoteTimer.current = null;
    };
  }, [needsShipping, ship.address_1, ship.postcode, ship.city]);

  function validate(): CheckoutProblems {
    return validateCheckout({
      billing: { ...billing },
      billingFields: [...BILLING_BEFORE_COUNTRY, ...BILLING_AFTER_COUNTRY],
      shipping: shipDiff ? { ...shipping } : null,
      shippingFields: SHIPPING_FIELDS,
      kennitala,
      needsShipping,
      rateChosen: selectedRate !== null,
      needsPostbox,
      postboxChosen,
      needsPayment,
      paymentChosen: paymentMethod !== '',
      terms,
    });
  }

  async function placeOrder() {
    // An address change whose re-quote is still waiting: run it now, then let the shopper see the result
    // (rates and totals may change) before placing the order. If the re-quote fails, its error shows and
    // the next press goes ahead (the Store API recalculates shipping at checkout anyway).
    if (quoteTimer.current !== null) {
      clearTimeout(quoteTimer.current);
      quoteTimer.current = null;
      lastQuote.current = JSON.stringify([ship.address_1, ship.postcode, ship.city].map((s) => s.trim()));
      const ok = await setCustomer({ shipping_address: addressFor(ship, billing.phone) }).then(() => true, () => false);
      setErrors(ok ? ['Sendingarkostnaður var uppfærður. Athugaðu pöntunina og smelltu aftur á „Panta“.'] : []);
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setAttempted(true);
    setErrors([]);
    if (validate().size) {
      // Once the messages are on the page, bring the first one into view.
      requestAnimationFrame(() => formRef.current?.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    setPlacing(true);
    const attempt = newAttemptId();
    const body = checkoutBody({
      billing, ship, notes, paymentMethod, needsPayment, kennitala, skiptimidi, attempt,
      createAccount: !signedIn && createAccount,
      postbox: needsPostbox && $droppoint ? $droppoint.id : null,
    });
    const outcome = await submitCheckout(body, attempt, {
      // In the cart queue: a re-quote or rate change still in flight must not race the order. The wait outlasts the
      // server's own (lib/timeouts), so its answer, or its recovery of a lost one, normally arrives first.
      send: (init) => withCartLock(() => fetch('/api/checkout', { ...init, signal: AbortSignal.timeout(CHECKOUT_CLIENT_TIMEOUT_MS) })),
      poll: (id) => pollCheckoutStatus(id),
      origin: window.location.origin,
      wpOrigin: MEDIA_BASE_URL,
      onRecovering: () => {
        setErrors([]);
        setChecking(true);
      },
    });
    setChecking(false);
    if (outcome.kind === 'go') {
      // The payment page, or the receipt. The button stays disabled while the page leaves.
      if (outcome.resetCart) resetCart();
      window.location.href = outcome.url;
      return;
    }
    setErrors([outcome.message]);
    setPlacing(false);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The first load failed: say so, with a retry, instead of "Sæki pöntun…" for ever (CO-01).
  if (cartViewState($cart, cartErr) === 'error') return <CartLoadError message={cartErr!} />;
  if (!$cart) return <p className="checkout-loading">Sæki pöntun…</p>;
  if (items.length === 0 && !placing) {
    return (
      <div className="checkout-empty">
        <p>Karfan þín er í augnablikinu tóm.</p>
        <a className="btn-outline" href="/verslun/">Til baka í vefverslun</a>
      </div>
    );
  }

  // Each problem is shown where it is (under its field, the shipping list, the terms); the list above the form
  // holds only what has no place of its own: the cart's and the order's errors.
  const problems: CheckoutProblems = attempted ? validate() : new Map();
  const shownErrors = [...new Set([...(cartErr ? [cartErr] : []), ...errors])];

  const field = (prefix: 'billing' | 'shipping', a: Address, set: (fn: (a: Address) => Address) => void) => (def: FieldDef) => (
    <FloatField
      key={`${prefix}_${def.key}`}
      id={`${prefix}_${def.key}`}
      def={def}
      value={a[def.key]}
      error={problems.get(`${prefix}_${def.key}`)}
      onChange={(v) => set((prev) => ({ ...prev, [def.key]: v }))}
    />
  );
  const billingField = field('billing', billing, setBilling);

  return (
    <form
      ref={formRef}
      className="checkout"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void placeOrder();
      }}
    >
      <div className="checkout__main">
        {checking && (
          <p className="checkout-notice" role="status">
            {CHECKING_MESSAGE}
          </p>
        )}
        {problems.size > 0 && (
          <p className="visually-hidden" role="alert">
            {problems.size === 1 ? 'Eitt atriði þarf að laga áður en pöntunin er send.' : `${problems.size} atriði þarf að laga áður en pöntunin er send.`}
          </p>
        )}
        {shownErrors.length > 0 && (
          <ul className="checkout-errors" role="alert">
            {shownErrors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="checkout__heading">
          <h3>Greiðsluupplýsingar</h3>
          <a className="checkout__back" href="/karfa/">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            Til baka í körfu
          </a>
        </div>

        <div className="checkout-fields">
          {BILLING_BEFORE_COUNTRY.map(billingField)}
          <FloatField
            id="billing_kennitala"
            def={{ label: 'Kennitala', width: 'first', inputMode: 'numeric' }}
            value={kennitala}
            error={problems.get('billing_kennitala')}
            onChange={setKennitala}
          />
          {billingField({ key: 'company', label: 'Nafn fyrirtækis', width: 'last', autoComplete: 'organization' })}
          <CountryField id="billing_country" width="wide" />
          {BILLING_AFTER_COUNTRY.map(billingField)}
        </div>

        <div className="checkout-ship">
          <label className="checkout-ship__toggle">
            <input type="checkbox" checked={shipDiff} onChange={(e) => setShipDiff(e.target.checked)} />
            <span>Senda á annað heimilisfang?</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          </label>
          {shipDiff && (
            <div className="checkout-fields">
              {SHIPPING_FIELDS.slice(0, 3).map(field('shipping', shipping, setShipping))}
              <CountryField id="shipping_country" width="wide" />
              {SHIPPING_FIELDS.slice(3).map(field('shipping', shipping, setShipping))}
            </div>
          )}
        </div>

        <div className="checkout-fields checkout-extra">
          {!signedIn && (
            <p className="form-row form-row-wide form-row-check">
              <label>
                <input type="checkbox" checked={createAccount} onChange={(e) => setCreateAccount(e.target.checked)} />
                <span>Stofna aðgang? Þú færð tölvupóst til að velja lykilorð og sérð pantanirnar þínar á „Mín síða“.</span>
              </label>
            </p>
          )}
          <p className="form-row form-row-wide form-row-check">
            <label>
              <input type="checkbox" checked={skiptimidi} onChange={(e) => setSkiptimidi(e.target.checked)} />
              <span>
                Viltu skiptimiða? Ekki er settur skiptimiði á útsöluvörur.
              </span>
            </label>
          </p>
          <p className={`form-row form-row-wide notes${notes ? ' has-val' : ''}`}>
            <textarea id="order_comments" className="input-text" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <label htmlFor="order_comments">
              Skilaboð<span className="optional"> (valfrjálst)</span>
            </label>
          </p>
        </div>
      </div>

      <div className="checkout__review" aria-busy={loading}>
        <h3 className="checkout__review-heading">Þín pöntun</h3>
        <table className="review-table">
          <tbody>
            {items.map((it) => (
              <tr className="review-table__item" key={it.key}>
                <td>
                  <div className="review-table__product">
                    <span className="review-table__thumb">
                      <LineImage item={it} size={60} />
                    </span>
                    <span className="review-table__name">
                      {decodeEntities(it.name)} <strong className="review-table__qty">× {it.quantity}</strong>
                      {it.variation?.length > 0 && <span className="review-table__meta">{variationText(it.variation)}</span>}
                    </span>
                  </div>
                </td>
                <td className="review-table__total">{formatStoreMoney(lineSubtotal(it), minor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Millisamtala</th>
              <td>{formatISK(cartSubtotal($cart))}</td>
            </tr>
            <CouponRows />
            {needsShipping && (
              <>
                <tr className="review-table__shipping-head">
                  <th colSpan={2} scope="row" id="review-shipping-label">Vörusendingar</th>
                </tr>
                <tr className="review-table__shipping">
                  <td colSpan={2} headers="review-shipping-label">
                    {rates.length > 0 && cartPostcode ? (
                      <ul className="ship-methods">
                        {rates.map((r) => (
                          <li key={r.rate_id}>
                            <label>
                              <input type="radio" name="shipping_method" checked={r.selected} disabled={placing} onChange={() => void selectShipping(r.rate_id).catch(() => { /* the cart store shows the error */ })} />
                              <span>
                                {decodeEntities(r.name)}
                                {Number(r.price) > 0 && <>: <span className="amount">{formatStoreMoney(r.price, r.currency_minor_unit)}</span></>}
                              </span>
                            </label>
                            {/* the Pósturinn locker is picked right under the rate that needs it (owner, 2026-11-14) */}
                            {r.selected && needsPostbox && <DroppointSelect postcode={cartPostcode} />}
                            {r.selected && problems.has('postbox') && <FieldError id="postbox_error" message={problems.get('postbox')!} />}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="review-table__hint">Sláðu inn heimilisfang til að sjá sendingarmöguleika.</span>
                    )}
                    {problems.has('shipping_method') && <FieldError id="shipping_method_error" message={problems.get('shipping_method')!} />}
                  </td>
                </tr>
              </>
            )}
            <tr className="review-table__total-row">
              <th>Samtals</th>
              <td>
                <strong>{totals ? formatStoreMoney(totals.total_price, minor) : ''}</strong>
              </td>
            </tr>
          </tfoot>
        </table>

        {/* the discount code sits in the summary, as on /karfa/ (same toggle state as before, only moved) */}
        <div className="checkout-coupon">
          <p className="checkout-coupon__toggle">
            <button type="button" aria-expanded={couponOpen} onClick={() => setCouponOpen((o) => !o)}>
              Ertu með afsláttarkóða?
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </p>
          {couponOpen && <CouponField variant="checkout" />}
        </div>

        <div className="checkout-payment">
          {needsPayment && methods.length > 0 && (
            <ul className="pay-methods">
              {methods.map((m) => {
                const meta = paymentMeta(m);
                return (
                  <li key={m} className="pay-method" data-selected={paymentMethod === m ? 'true' : undefined}>
                    <label>
                      <input type="radio" name="payment_method" checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} />
                      <span>{meta.label}</span>
                      {meta.cards && <CardLogos />}
                    </label>
                    {paymentMethod === m && meta.desc && <div className="pay-box">{meta.desc}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          {problems.has('payment_method') && <FieldError id="payment_method_error" message={problems.get('payment_method')!} />}
          <p className="checkout-privacy">
            Persónulegu gögnin þín munu vera notuð til að ganga frá pöntuninni, fyrir stuðning á notkun þinni á vefsíðunni o.fl sem við
            útskýrum í <a href="/skilmalar/" target="_blank" rel="noopener">persónuverndarstefnu</a>.
          </p>
          <label className="checkout-terms">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              aria-required="true"
              aria-invalid={problems.has('terms') ? 'true' : undefined}
              aria-describedby={problems.has('terms') ? 'terms_error' : undefined}
            />
            <span>
              Ég hef lesið skilmálana og samþykki þá{' '}
              <a href="/skilmalar/" target="_blank" rel="noopener">
                skilmála
              </a>{' '}
              <abbr className="required" title="nauðsynlegt">*</abbr>
            </span>
          </label>
          {problems.has('terms') && <FieldError id="terms_error" message={problems.get('terms')!} />}
          <button type="submit" className="btn-dark btn-block checkout__place" disabled={placing || loading} aria-busy={placing}>
            Panta
          </button>
        </div>
      </div>
    </form>
  );
}
