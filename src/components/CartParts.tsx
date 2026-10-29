// Small pieces shared by the side cart and /karfa/: the quantity stepper (a quiet pill), the trash button, the thumbnail,
// and the failed-load notice.
import { useStore } from '@nanostores/react';
import { mediaUrl, PLACEHOLDER } from '../lib/img';
import { cartLoading, removeLine, retryCartLoad, stepQty } from '../lib/cartStore';
import type { CartItem } from '../lib/types';

export function LineImage({ item, size }: { item: CartItem; size: number }) {
  return (
    <img
      src={mediaUrl(item.images?.[0]?.src) || PLACEHOLDER}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        const el = e.currentTarget;
        if (!el.src.endsWith(PLACEHOLDER)) {
          el.src = PLACEHOLDER;
          el.onerror = null;
        }
      }}
    />
  );
}

// The cart store already shows a failed change (cartError), so the buttons only keep the rejection quiet.
const quiet = () => {};

// Each click counts from the last queued quantity, not the rendered one (CO-06): quick clicks all count.
export function QtyStepper({ item }: { item: CartItem }) {
  return (
    <div className="line-qty">
      <button type="button" onClick={() => void stepQty(item.key, -1).catch(quiet)} aria-label="Fækka" disabled={item.quantity <= 1}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <span className="line-qty__n" aria-label="Fjöldi">{item.quantity}</span>
      <button type="button" onClick={() => void stepQty(item.key, 1).catch(quiet)} aria-label="Fjölga">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

export function RemoveButton({ item, name }: { item: CartItem; name: string }) {
  return (
    <button type="button" className="line-remove" onClick={() => void removeLine(item.key).catch(quiet)} aria-label={`Fjarlægja ${name} úr körfu`}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** The cart could not be loaded (CO-01): say so and offer a retry, instead of "Sæki…" for ever or an empty cart. */
export function CartLoadError({ message }: { message: string }) {
  const loading = useStore(cartLoading);
  return (
    <div className="cart-load-error" role="alert">
      <p className="form-error">{message}</p>
      <button type="button" className="btn-outline" onClick={retryCartLoad} disabled={loading}>
        Reyna aftur
      </button>
    </div>
  );
}
