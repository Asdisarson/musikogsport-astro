// Discount-code field shared by the cart page, cart drawer, and checkout summary.
// Applies/removes coupons against the server cart (Store API) via cartStore.
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, applyCoupon, removeCoupon } from '../lib/cartStore';

interface Props {
  /** Tighter layout for the cart drawer. */
  compact?: boolean;
}

export default function CouponField({ compact = false }: Props) {
  const $cart = useStore(cart);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coupons = $cart?.coupons ?? [];

  async function onApply() {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    try {
      await applyCoupon(c);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ógildur afsláttarkóði.');
      cartError.set(null); // surface the message inline only, not also in the cart-wide error banner
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(c: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeCoupon(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Villa kom upp. Reyndu aftur.');
      cartError.set(null); // surface the message inline only, not also in the cart-wide error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`coupon${compact ? ' coupon--compact' : ''}`}>
      {coupons.length > 0 && (
        <ul className="coupon__chips" aria-label="Virkir afsláttarkóðar">
          {coupons.map((c) => (
            <li key={c.code} className="coupon__chip">
              <span>{c.code.toUpperCase()}</span>
              <button
                type="button"
                aria-label={`Fjarlægja afsláttarkóða ${c.code}`}
                onClick={() => onRemove(c.code)}
                disabled={busy}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="coupon__form"
        onSubmit={(e) => {
          e.preventDefault();
          void onApply();
        }}
      >
        <input
          type="text"
          name="coupon"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Afsláttarkóði"
          aria-label="Afsláttarkóði"
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className="btn btn--ghost btn--sm" disabled={busy || !code.trim()}>
          {busy ? '…' : 'Nota'}
        </button>
      </form>
      {error && (
        <p className="coupon__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
