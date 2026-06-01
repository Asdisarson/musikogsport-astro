import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, closeCart, ensureLoaded, isCartOpen, removeLine, updateQty } from '../lib/cartStore';
import { formatStoreMoney } from '../lib/format';
import { mediaUrl, PLACEHOLDER } from '../lib/img';
import { decodeEntities } from '../lib/decode';

function slugFromPermalink(permalink?: string): string | null {
  if (!permalink) return null;
  const parts = permalink.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || null;
}

export default function CartDrawer() {
  const $cart = useStore(cart);
  const open = useStore(isCartOpen);
  const err = useStore(cartError);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ensureLoaded();
  }, []);

  // When open: lock background scroll, move focus into the drawer, close on
  // Escape, and restore scroll + focus to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCart();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const items = $cart?.items ?? [];
  const totals = $cart?.totals;

  return (
    <>
      <div className="drawer-overlay" onClick={closeCart} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Karfa">
        <div className="drawer__head">
          <h2>Karfa</h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={closeCart} aria-label="Loka körfu">×</button>
        </div>

        <div className="drawer__body">
          {err && <p className="form-error" role="alert">{err}</p>}
          {items.length === 0 ? (
            <p className="muted">Karfan þín er tóm.</p>
          ) : (
            items.map((it) => {
              const slug = slugFromPermalink(it.permalink);
              return (
                <div className="cart-line" key={it.key}>
                  <div className="cart-line__media">
                    <img
                      src={mediaUrl(it.images?.[0]?.src) || PLACEHOLDER}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
                      }}
                    />
                  </div>
                  <div>
                    {slug ? (
                      <a className="cart-line__title" href={`/vara/${slug}`}>{decodeEntities(it.name)}</a>
                    ) : (
                      <p className="cart-line__title">{decodeEntities(it.name)}</p>
                    )}
                    {it.variation?.map((v) => (
                      <span className="cart-line__meta" key={v.attribute}>
                        {v.attribute}: {v.value}{' '}
                      </span>
                    ))}
                    <div className="qty" style={{ marginTop: '0.4rem' }}>
                      <button type="button" onClick={() => updateQty(it.key, Math.max(1, it.quantity - 1))} aria-label="Fækka">−</button>
                      <input value={it.quantity} readOnly aria-label="Fjöldi" />
                      <button type="button" onClick={() => updateQty(it.key, it.quantity + 1)} aria-label="Fjölga">+</button>
                    </div>
                    <button type="button" className="cart-line__remove" onClick={() => removeLine(it.key)}>Fjarlægja</button>
                  </div>
                  <div>{formatStoreMoney(it.totals.line_total, it.totals.currency_minor_unit)}</div>
                </div>
              );
            })
          )}
        </div>

        {items.length > 0 && totals && (
          <div className="drawer__foot">
            <div className="cart-totals">
              <span>Samtals</span>
              <span>{formatStoreMoney(totals.total_price, totals.currency_minor_unit)}</span>
            </div>
            <a className="btn" href="/karfa" onClick={closeCart}>Skoða körfu</a>
            <a className="btn btn--primary" href="/utskra" onClick={closeCart}>Ganga frá pöntun</a>
          </div>
        )}
      </aside>
    </>
  );
}
