import { useId, useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, selectShipping, setCustomer } from '../lib/cartStore';
import { rateNeedsPostbox } from '../lib/droppointStore';
import { formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import DroppointSelect from './DroppointSelect';

// In-cart shipping estimator: enter an Icelandic postcode → live Pósturinn rates.
// Rates depend only on the postcode, so we send a placeholder city (the Store API
// requires a non-empty city, but it doesn't affect the price); the real address is
// collected at checkout. The chosen rate persists into the checkout session.
export default function ShippingEstimator() {
  const $cart = useStore(cart);
  const gid = useId();
  const [pc, setPc] = useState(() => $cart?.shipping_address?.postcode ?? '');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!$cart?.needs_shipping) return null;

  const rates = $cart.shipping_rates?.[0]?.shipping_rates ?? [];
  // The postcode the current rates were calculated for. If the input no longer
  // matches it, the shown rates are stale (user edited without re-submitting).
  const calculatedPc = $cart.shipping_address?.postcode ?? '';
  const stale = pc.trim() !== calculatedPc;
  const showRates = !stale && rates.length > 0;
  const showEmpty = !stale && calculatedPc !== '' && rates.length === 0 && !busy && !err;
  const selectedRate = rates.find((r) => r.selected);
  const needsPostbox = !stale && rateNeedsPostbox(selectedRate?.rate_id);

  async function estimate() {
    if (busy) return;
    const code = pc.trim();
    if (!/^\d{3}$/.test(code)) {
      setErr('Sláðu inn þriggja stafa póstnúmer.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await setCustomer({ shipping_address: { country: 'IS', postcode: code, city: '-' } });
    } catch {
      setErr('Gat ekki reiknað sendingu. Reyndu aftur.');
    } finally {
      setBusy(false);
    }
  }

  async function choose(rateId: string) {
    if (selecting) return;
    setSelecting(true);
    setErr(null);
    try {
      await selectShipping(rateId);
    } catch {
      setErr('Villa við val á sendingu.');
    } finally {
      setSelecting(false);
    }
  }

  return (
    <div className="ship-calc">
      <p className="ship-calc__label">Áætla sendingu</p>
      <form
        className="ship-calc__row"
        onSubmit={(e) => {
          e.preventDefault();
          void estimate();
        }}
      >
        <input
          className="ship-calc__pc"
          inputMode="numeric"
          maxLength={3}
          placeholder="Póstnúmer"
          value={pc}
          onChange={(e) => setPc(e.target.value.replace(/[^\d]/g, ''))}
          aria-label="Póstnúmer fyrir sendingaráætlun"
        />
        <button type="submit" className="btn btn--ghost btn--sm" aria-busy={busy}>
          {busy ? 'Reikna…' : 'Reikna'}
        </button>
      </form>

      {showRates && (
        <fieldset className="ship-calc__rates">
          <legend className="visually-hidden">Veldu sendingarmáta</legend>
          {rates.map((r) => (
            <label className="radio-card radio-card--sm" key={r.rate_id}>
              <input
                type="radio"
                name={`cart-shipping-${gid}`}
                checked={r.selected}
                disabled={selecting}
                onChange={() => void choose(r.rate_id)}
              />
              <span className="ship-calc__rate">
                <span>{decodeEntities(r.name)}</span>
                <strong>{formatStoreMoney(r.price, r.currency_minor_unit)}</strong>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {showEmpty && <p className="form-note">Engar sendingarleiðir fundust fyrir þetta póstnúmer.</p>}

      {needsPostbox && <DroppointSelect postcode={calculatedPc} />}

      <p className="visually-hidden" role="status" aria-live="polite">
        {busy ? 'Reikna sendingu…' : showRates ? `${rates.length} sendingarmátar í boði` : ''}
      </p>

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
