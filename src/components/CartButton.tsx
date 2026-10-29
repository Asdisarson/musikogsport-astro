import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { cartCount, ensureLoaded, openCart } from '../lib/cartStore';
import { countWord } from '../lib/plural';

export default function CartButton() {
  const count = useStore(cartCount);
  const [mounted, setMounted] = useState(false);
  const [pop, setPop] = useState(false);
  const prev = useRef(0);

  useEffect(() => {
    setMounted(true);
    ensureLoaded();
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (count > prev.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 320);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count, mounted]);

  // Before mount, render the server state (count 0) so hydration matches; the real
  // cart count (read from the httpOnly cookie client-side) fills in just after.
  const shown = mounted ? count : 0;

  return (
    <button
      type="button"
      className="icon-btn cart-link"
      onClick={openCart}
      aria-label={shown > 0 ? `Opna körfu (${countWord(shown, 'vara', 'vörur')})` : 'Opna körfu'}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* the `bag` glyph of Icon.astro */}
        <path d="M4.5 8.5h15l-1.2 11.6a1 1 0 0 1-1 .9H6.7a1 1 0 0 1-1-.9L4.5 8.5Z" />
        <path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5" />
      </svg>
      <span className="cart-count icon-count" data-count={shown} data-pop={pop ? 'true' : undefined}>
        {shown > 0 ? shown : ''}
      </span>
    </button>
  );
}
