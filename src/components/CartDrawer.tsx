import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, closeCart, ensureLoaded, isCartOpen } from '../lib/cartStore';
import { formatISK, formatStoreMoney } from '../lib/format';
import { decodeEntities } from '../lib/decode';
import { cartSubtotal, cartViewState, lineHref, lineSubtotal, variationText } from '../lib/cartView';
import type { ShippingBar } from '../lib/shippingBar';
import { CartLoadError, LineImage, QtyStepper, RemoveButton } from './CartParts';
import ShippingBarView from './ShippingBarView';

// The side cart (nike-look): a 440px white panel from the right over a dimmed page — "Karfa" 24/500 + count, the
// /karfa/ line anatomy at 96px (#f5f5f5 image, name, variation, stepper pill, trash), then Millisamtala, the
// free-shipping bar and "Ganga frá pöntun" (black pill) over "Skoða körfu" (outline pill).
export default function CartDrawer({ shippingBar = null }: { shippingBar?: ShippingBar | null }) {
  const $cart = useStore(cart);
  const open = useStore(isCartOpen);
  const err = useStore(cartError);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    ensureLoaded();
  }, []);

  // While open: lock page scroll, move focus in, trap Tab, close on Escape, restore focus on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('overlay-open');
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeCart();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('overlay-open');
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const items = $cart?.items ?? [];
  const totals = $cart?.totals;
  const minor = totals?.currency_minor_unit ?? 0;
  const view = cartViewState($cart, err);

  return (
    <>
      <div className="side-cart-overlay" onClick={closeCart} />
      <aside ref={panelRef} className="side-cart" role="dialog" aria-modal="true" aria-label="Karfa">
        <header className="side-cart__head">
          <div className="side-cart__title">
            Karfa <span className="side-cart__count">{$cart?.items_count ?? 0}</span>
          </div>
          <button ref={closeRef} type="button" className="side-cart__close" onClick={closeCart} aria-label="Loka körfu">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </header>

        <div className="side-cart__body">
          {/* A failed first load shows only the error and a retry: never "Karfan er tóm" for a cart we couldn't read (CO-01). */}
          {view === 'error' && <CartLoadError message={err!} />}
          {view === 'loading' && <p className="side-cart__loading">Sæki körfu…</p>}
          {err && (view === 'empty' || view === 'ready') && <p className="form-error" role="alert">{err}</p>}
          {view === 'empty' && (
            <div className="side-cart__empty">
              <p>Karfan er tóm</p>
              <a className="btn-dark" href="/verslun/" onClick={closeCart}>Halda áfram að versla</a>
            </div>
          )}
          {view === 'ready' && (
            <ul className="side-cart__items">
              {items.map((it) => {
                const name = decodeEntities(it.name);
                const href = lineHref(it.permalink);
                return (
                  <li className="side-cart__item" key={it.key}>
                    <a className="side-cart__thumb" href={href ?? undefined} tabIndex={-1} aria-hidden="true">
                      <LineImage item={it} size={60} />
                    </a>
                    <div className="side-cart__details">
                      <span className="side-cart__name">{href ? <a href={href}>{name}</a> : name}</span>
                      {it.variation?.length > 0 && (
                        <span className="side-cart__meta">{variationText(it.variation)}</span>
                      )}
                      <div className="side-cart__qty-row">
                        <QtyStepper item={it} />
                        <span className="side-cart__price">{formatStoreMoney(lineSubtotal(it), minor)}</span>
                      </div>
                      <RemoveButton item={it} name={name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && totals && (
          <div className="side-cart__summary">
            <p className="side-cart__total">
              <span>Millisamtala:</span>
              <span>{formatISK(cartSubtotal($cart))}</span>
            </p>
            {shippingBar && <ShippingBarView bar={shippingBar} subtotal={cartSubtotal($cart, shippingBar.includeTaxes)} />}
            <a className="btn-dark btn-block" href="/gera-upp/" onClick={closeCart}>Ganga frá pöntun</a>
            <a className="btn-outline btn-block" href="/karfa/" onClick={closeCart}>Skoða körfu</a>
          </div>
        )}
      </aside>
    </>
  );
}
