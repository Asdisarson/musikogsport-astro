import { useId, useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, selectShipping, setCustomer } from '../lib/cartStore';
import { rateNeedsPostbox } from '../lib/droppointStore';
import { formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import { cartCity } from '../lib/cartCity';
import DroppointSelect from './DroppointSelect';

// The "Vörusendingar" cell of live's cart totals (WooCommerce's shipping calculator): a
// "Reikna sendingarkostnað" toggle that opens a postcode/town form; once an address is known, the
// Pósturinn rates as radios (and the locker picker for "Pakki Póstbox"). The rate chosen here carries
// into the checkout session.
export default function ShippingCalc() {
  const $cart = useStore(cart);
  const gid = useId();
  const address = $cart?.shipping_address ?? {};
  // the Store API's '-' / '&#8211;' town placeholder is no town
  const town = cartCity(address.city);
  const [open, setOpen] = useState(false);
  const [postcode, setPostcode] = useState(address.postcode ?? '');
  const [city, setCity] = useState(town);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!$cart?.needs_shipping) return null;
  const rates = $cart.shipping_rates?.[0]?.shipping_rates ?? [];
  const known = Boolean(address.postcode);
  const selected = rates.find((r) => r.selected);

  async function calculate() {
    if (!/^\d{3}$/.test(postcode.trim())) {
      setErr('Sláðu inn þriggja stafa póstnúmer.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Rates depend on the postcode only; the Store API wants a non-empty town.
      await setCustomer({ shipping_address: { country: 'IS', postcode: postcode.trim(), city: city.trim() || '-' } });
      setOpen(false);
    } catch {
      setErr('Gat ekki reiknað sendingu. Reyndu aftur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ship-calc">
      {known && rates.length > 0 && (
        <ul className="ship-methods">
          {rates.map((r) => (
            <li key={r.rate_id}>
              <label>
                <input type="radio" name={`cart-ship-${gid}`} checked={r.selected} onChange={() => void selectShipping(r.rate_id).catch(() => { /* the cart store shows the error */ })} />
                <span>
                  {decodeEntities(r.name)}
                  {Number(r.price) > 0 && <>: <span className="amount">{formatStoreMoney(r.price, r.currency_minor_unit)}</span></>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {known && rates.length === 0 && <p className="ship-calc__note">Engar sendingarleiðir fundust fyrir þetta póstnúmer.</p>}
      {known && (
        <p className="ship-calc__dest">
          Sending til <strong>{address.postcode}{town ? ` ${town}` : ''}</strong>.
        </p>
      )}
      {known && rateNeedsPostbox(selected?.rate_id) && <DroppointSelect postcode={address.postcode ?? ''} />}

      <button type="button" className="ship-calc__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        {known ? 'Breyta heimilisfangi' : 'Reikna sendingarkostnað'}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
      </button>
      {open && (
        <form
          className="ship-calc__form"
          onSubmit={(e) => {
            e.preventDefault();
            void calculate();
          }}
        >
          <input value="Ísland" readOnly aria-label="Land" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Borg / Bær" aria-label="Borg / Bær" autoComplete="address-level2" />
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="Póstnúmer"
            aria-label="Póstnúmer"
            inputMode="numeric"
            autoComplete="postal-code"
          />
          <button type="submit" className="btn-outline btn-sm" aria-busy={busy} disabled={busy}>
            Uppfæra
          </button>
        </form>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
