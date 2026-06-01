import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { cartCount, ensureLoaded, openCart } from '../lib/cartStore';

export default function CartButton() {
  const count = useStore(cartCount);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return (
    <button type="button" className="cart-link" onClick={openCart} aria-label="Opna körfu">
      Karfa
      <span className="cart-count" data-count={count}>{count > 0 ? count : ''}</span>
    </button>
  );
}
