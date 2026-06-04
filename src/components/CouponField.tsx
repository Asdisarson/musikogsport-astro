// Discount-code field shared by the cart page, cart drawer, and checkout summary.
// Applies/removes coupons against the server cart (Store API) via cartStore.
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, applyCoupon, removeCoupon } from '../lib/cartStore';

// Map the stable English WooCommerce coupon-validation strings to Icelandic. WP returns these in
// English when the site locale isn't is_IS (the source-level fix is Settings → Site Language). If a
// message is already localized (no English pattern matches), it passes through unchanged.
function couponErrorIs(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('does not exist')) return 'Afsláttarkóðinn er ekki til.';
  if (m.includes('expired')) return 'Afsláttarkóðinn er útrunninn.';
  if (m.includes('usage limit')) return 'Notkunarmörkum afsláttarkóðans hefur verið náð.';
  if (m.includes('minimum spend') || m.includes('minimum order')) return 'Lágmarksupphæð fyrir afsláttarkóðann er ekki náð.';
  if (m.includes('maximum spend')) return 'Karfan fer yfir hámarksupphæð afsláttarkóðans.';
  if (m.includes('already applied') || m.includes('already been applied')) return 'Afsláttarkóðinn er nú þegar virkur.';
  if (m.includes('sale items')) return 'Afsláttarkóðinn gildir ekki á útsöluvörur.';
  if (m.includes('not applicable') || m.includes('not valid for the products')) return 'Afsláttarkóðinn á ekki við vörurnar í körfunni.';
  if (m.includes('email')) return 'Afsláttarkóðinn er bundinn við tiltekið netfang.';
  return msg;
}

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
      setError(err instanceof Error ? couponErrorIs(err.message) : 'Ógildur afsláttarkóði.');
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
      setError(err instanceof Error ? couponErrorIs(err.message) : 'Villa kom upp. Reyndu aftur.');
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
