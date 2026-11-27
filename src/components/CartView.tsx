import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, ensureLoaded } from '../lib/cartStore';
import { formatISK, formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import { cartSubtotal, cartViewState, lineHref, lineSubtotal, variationText } from '../lib/cartView';
import type { ShippingBar } from '../lib/shippingBar';
import { CartLoadError, LineImage, QtyStepper, RemoveButton } from './CartParts';
import CouponField, { CouponRows } from './CouponField';
import ShippingBarView from './ShippingBarView';
import ShippingCalc from './ShippingCalc';

// /karfa/ (nike-look, SPEC § Bag): the lines left (150px #f5f5f5 image, name and price, the variation in grey, a
// quiet stepper pill and a trash button), "Samantekt" right (rows, the total, the discount code behind a
// <details>, the free-shipping bar, "Ganga frá pöntun"). The "Karfa" h1 is server-rendered by routes/cart.astro.
export default function CartView({ shippingBar = null }: { shippingBar?: ShippingBar | null }) {
  const $cart = useStore(cart);
  const err = useStore(cartError);

  useEffect(() => {
    ensureLoaded();
  }, []);

  const view = cartViewState($cart, err);
  if (view === 'error') return <CartLoadError message={err!} />;
  if (!$cart) return <p className="cart-page__loading">Sæki körfu…</p>;

  if (view === 'empty') {
    return (
      <div className="cart-empty">
        <p className="cart-empty__msg" role="status">Karfan er tóm</p>
        <a className="btn-dark" href="/verslun/">Halda áfram að versla</a>
      </div>
    );
  }

  const t = $cart.totals;
  const minor = t.currency_minor_unit;
  return (
    <div className="cart-page">
      <div className="cart-page__row">
        <div className="cart-page__items">
          {err && <p className="form-error" role="alert">{err}</p>}
          <ul className="cart-lines">
            {$cart.items.map((it) => {
              const name = decodeEntities(it.name);
              const href = lineHref(it.permalink);
              return (
                <li className="cart-line" key={it.key}>
                  <a className="cart-line__thumb" href={href ?? undefined} tabIndex={-1} aria-hidden="true">
                    <LineImage item={it} size={95} />
                  </a>
                  <div className="cart-line__name">
                    {href ? <a href={href}>{name}</a> : name}
                    {it.variation?.length > 0 && (
                      <span className="cart-line__meta">{variationText(it.variation)}</span>
                    )}
                    {/* the unit price only adds information when it differs from the line total */}
                    {it.quantity > 1 && <span className="cart-line__price">{formatStoreMoney(it.prices.price, minor)} / stk.</span>}
                  </div>
                  <div className="cart-line__qty">
                    <QtyStepper item={it} />
                  </div>
                  <div className="cart-line__subtotal">{formatStoreMoney(lineSubtotal(it), minor)}</div>
                  <div className="cart-line__remove">
                    <RemoveButton item={it} name={name} />
                  </div>
                </li>
              );
            })}
          </ul>
          <a className="cart-page__back-link" href="/verslun/">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            Halda áfram að versla
          </a>
        </div>

        <div className="cart-totals">
          <h2>Samantekt</h2>
          <table>
            <tbody>
              <tr>
                <th>Millisamtala</th>
                <td>{formatISK(cartSubtotal($cart))}</td>
              </tr>
              <CouponRows />
              {$cart.needs_shipping && (
                <>
                  {/* label row above the calculator, so the toggle gets the full width */}
                  <tr className="cart-totals__shipping-head">
                    <th colSpan={2} scope="row" id="cart-shipping-label">Vörusendingar</th>
                  </tr>
                  <tr className="cart-totals__shipping">
                    <td colSpan={2} headers="cart-shipping-label">
                      <ShippingCalc />
                    </td>
                  </tr>
                </>
              )}
              <tr className="cart-totals__total">
                <th>Samtals</th>
                <td>
                  <strong>{formatStoreMoney(t.total_price, minor)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          {/* the discount code waits behind a native <details> (no state): reading order matches the layout */}
          <details className="cart-totals__coupon">
            <summary>
              Ertu með afsláttarkóða?
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </summary>
            <CouponField variant="cart" />
          </details>
          {shippingBar && <ShippingBarView bar={shippingBar} subtotal={cartSubtotal($cart, shippingBar.includeTaxes)} />}
          <a className="btn-dark btn-block cart-totals__checkout" href="/gera-upp/">
            Ganga frá pöntun
          </a>
          <p className="cart-totals__note">Sendingarmáti og greiðslumáti eru staðfestir í næsta skrefi.</p>
        </div>
      </div>
    </div>
  );
}
