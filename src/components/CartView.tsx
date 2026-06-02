import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { cart, cartError, ensureLoaded, removeLine, updateQty } from '../lib/cartStore';
import { formatStoreMoney } from '../lib/format';
import { mediaUrl, PLACEHOLDER } from '../lib/img';
import { decodeEntities } from '../lib/decode';
import ShippingEstimator from './ShippingEstimator';

function slugFromPermalink(permalink?: string): string | null {
  if (!permalink) return null;
  const parts = permalink.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || null;
}

export default function CartView() {
  const $cart = useStore(cart);
  const err = useStore(cartError);

  useEffect(() => {
    ensureLoaded();
  }, []);

  if (!$cart) return <p className="muted">Sæki körfu…</p>;

  const items = $cart.items;
  if (items.length === 0) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <p className="muted" style={{ marginBottom: '1rem' }}>Karfan þín er tóm.</p>
        <a className="btn btn--accent" href="/verslun">Skoða vörur</a>
      </div>
    );
  }

  const t = $cart.totals;
  const rates = $cart.shipping_rates?.[0]?.shipping_rates ?? [];
  const hasShipping = rates.some((r) => r.selected);
  return (
    <div className="layout-2col">
      <div className="panel">
        {err && <p className="form-error" role="alert">{err}</p>}
        {items.map((it) => {
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
        })}
      </div>

      <aside className="panel summary">
        <h2 className="panel__title">Samantekt</h2>
        {$cart.needs_shipping && (
          <>
            <ShippingEstimator />
            <hr className="summary__sep" />
          </>
        )}
        <div className="summary__row">
          <span>Vörur ({$cart.items_count})</span>
          <strong>{formatStoreMoney(t.total_items, t.currency_minor_unit)}</strong>
        </div>
        {hasShipping && (
          <div className="summary__row">
            <span>Sending</span>
            <strong>{formatStoreMoney(t.total_shipping ?? '0', t.currency_minor_unit)}</strong>
          </div>
        )}
        <div className="summary__row summary__row--total">
          <span>Samtals</span>
          <span>{formatStoreMoney(t.total_price, t.currency_minor_unit)}</span>
        </div>
        <a className="btn btn--accent btn--block btn--lg" href="/utskra" style={{ marginTop: '1.25rem' }}>
          Ganga frá pöntun
        </a>
        <p className="form-note" style={{ marginTop: '0.5rem' }}>Áætlað verð — staðfest í greiðsluferli.</p>
      </aside>
    </div>
  );
}
