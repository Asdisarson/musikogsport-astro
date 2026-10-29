// Discount codes, as on live: an "Afsláttarkóði" field + "Nýta afsláttarkóða" on /karfa/ and behind
// the "Ertu með afsláttarkóða?" toggle on the checkout; applied codes show as rows in the totals
// table with a "[Fjarlægja]" link (WooCommerce's cart-discount row).
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, applyCoupon, removeCoupon } from '../lib/cartStore';
import { formatStoreMoney } from '../lib/format';

// Map the stable English WooCommerce coupon-validation strings to Icelandic. WP returns these in
// English when the site locale isn't is_IS. Already-localized messages pass through unchanged.
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

export default function CouponField({ variant = 'cart' }: { variant?: 'cart' | 'checkout' }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      cartError.set(null); // inline only, not also in the cart-wide error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`coupon coupon--${variant}`}>
      {/* Not a <form>: on the checkout this sits inside the checkout form, and a nested form would make
          "Nýta afsláttarkóða" (or Enter) submit the order form and reload the page. */}
      <div className="coupon__form">
        <input
          type="text"
          name="coupon_code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // never submit the surrounding checkout form
            void onApply();
          }}
          placeholder="Afsláttarkóði"
          aria-label="Afsláttarkóði"
          autoComplete="off"
          disabled={busy}
        />
        <button type="button" className="btn-outline coupon__apply" disabled={busy} aria-busy={busy} onClick={() => void onApply()}>
          Nýta afsláttarkóða
        </button>
      </div>
      {error && (
        <p className="coupon__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** WooCommerce's "Afsláttarkóði: X" totals rows, each with a remove link. */
export function CouponRows() {
  const $cart = useStore(cart);
  const [busy, setBusy] = useState(false);
  const coupons = $cart?.coupons ?? [];
  const minor = $cart?.totals.currency_minor_unit ?? 0;

  async function onRemove(c: string) {
    if (busy) return;
    setBusy(true);
    try {
      await removeCoupon(c);
    } catch {
      /* surfaced via cartError */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {coupons.map((c) => (
        <tr className="cart-discount" key={c.code}>
          <th>Afsláttarkóði: {c.code}</th>
          <td>
            -{formatStoreMoney(String(Number(c.totals?.total_discount ?? 0) + Number(c.totals?.total_discount_tax ?? 0)), minor)}{' '}
            <button type="button" className="coupon__remove" onClick={() => onRemove(c.code)} disabled={busy}>
              [Fjarlægja]
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}
