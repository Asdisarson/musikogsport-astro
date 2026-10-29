import { useEffect, useRef, useState } from 'react';
import { PLACEHOLDER } from '../lib/img';
import { cardFillProps } from '../lib/photoBg';
import { formatSaleBadge } from '../lib/price';
import { cardLabel } from '../lib/productCard';
import { WISHLIST_MAX_IDS } from '../lib/wishlist';
import type { ProductSummary } from '../lib/types';

// localStorage persistence shape — hearts store only this minimal snapshot (the live card,
// with price/stock, is the fetched ProductSummary below).
interface Stored {
  id: number;
  slug: string;
  /** Live /verslun/<cat>/<slug>/ URL; absent on snapshots saved before the live-URL switch. */
  path?: string;
  name: string;
  image: string;
}

const WKEY = 'mos-wishlist';
// The cards' image width (measured 130–557px): 3 columns from 992px, one third of the window up to the 1800px
// frame (557px images), 2 columns below (a little over half the window).
const WISHLIST_SIZES = '(min-width: 992px) min(33vw, 560px), 50vw';

function readStore(): Stored[] {
  try {
    const a = JSON.parse(localStorage.getItem(WKEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'number') : [];
  } catch {
    return [];
  }
}

// Wishlist page body. Hearts only persist {id,slug,name,image}; here we fetch CURRENT
// price/stock by id so saved items never show a stale snapshot. Stored fields are the
// fallback if the catalog fetch fails. Removal writes localStorage + fires mos:wishlist
// (the Base.astro controller keeps the header count in sync).
export default function WishlistView() {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored[]>([]);
  const [fresh, setFresh] = useState<Record<number, ProductSummary>>({});
  // true once a catalog fetch succeeds — lets us tell "deleted/unpublished" (in store
  // but absent from a successful response) apart from "fetch failed, use stored fallback".
  const [fetchOk, setFetchOk] = useState(false);
  // Ids we actually asked the API to resolve (capped to WISHLIST_MAX_IDS, matching the server).
  // Only THESE are eligible for the "gone" verdict; items past the cap fall back to their snapshot.
  const [attempted, setAttempted] = useState<Set<number>>(new Set());
  // After a removal: the polite announcement, and where focus goes (the removed card's button is gone).
  const [announce, setAnnounce] = useState('');
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  async function load() {
    const s = readStore();
    setStored(s);
    setFetchOk(false);
    if (s.length === 0) {
      setFresh({});
      setAttempted(new Set());
      setReady(true);
      return;
    }
    // Cap the request to the server's limit so ids beyond it aren't sent (and aren't mislabeled
    // "gone" when they come back absent from a 200 — they simply keep their stored snapshot).
    const sentIds = s.slice(0, WISHLIST_MAX_IDS).map((x) => x.id);
    setAttempted(new Set(sentIds));
    try {
      const res = await fetch(`/api/products?ids=${sentIds.join(',')}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000), // a hung request falls back to the stored snapshot, not "Sæki…" for ever
      });
      if (res.ok) {
        const arr: ProductSummary[] = await res.json();
        const map: Record<number, ProductSummary> = {};
        for (const c of arr) map[c.id] = c;
        setFresh(map);
        setFetchOk(true);
      }
    } catch {
      /* fall back to stored fields */
    }
    setReady(true);
  }

  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === WKEY) load();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Focus the next card's remove button (the previous one at the end), or the empty state's link.
  useEffect(() => {
    if (focusAt === null || !root.current) return;
    const buttons = root.current.querySelectorAll<HTMLElement>('.wish-btn');
    (buttons[Math.min(focusAt, buttons.length - 1)] ?? root.current.querySelector<HTMLElement>('a'))?.focus();
    setFocusAt(null);
  }, [focusAt]);

  function remove(id: number, name: string, index: number) {
    const next = readStore().filter((x) => x.id !== id);
    try {
      localStorage.setItem(WKEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('mos:wishlist')); // header count re-syncs
    setStored(next);
    setAnnounce(`„${name}“ fjarlægð af óskalista.`);
    setFocusAt(index);
  }

  const status = (
    <p className="visually-hidden" role="status">
      {announce}
    </p>
  );

  if (!ready) return <p className="muted">Sæki óskalista…</p>;

  if (stored.length === 0) {
    return (
      <div ref={root} className="panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        {status}
        <p className="muted" style={{ marginBottom: '1rem' }}>Óskalistinn þinn er tómur.</p>
        <a className="btn btn--accent" href="/verslun/">Skoða vörur</a>
      </div>
    );
  }

  const heartIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20 10.6 18.7C5.8 14.4 3 11.8 3 8.6 3 6 5 4 7.6 4c1.6 0 3.2.8 4.4 2.1C13.2 4.8 14.8 4 16.4 4 19 4 21 6 21 8.6c0 3.2-2.8 5.8-7.6 10.1L12 20Z" />
    </svg>
  );
  // The price line as the wall cards draw it: the price (a "frá " prefix muted), the struck original, then the
  // green "-N%".
  const priceLine = (c: ProductSummary) => (
    <div className="product-card__price">
      <span className="price">
        {c.priceText?.startsWith('frá ') ? (
          <>
            <span className="price__from">frá </span>
            {c.priceText.slice(4)}
          </>
        ) : (
          c.priceText
        )}
        {c.wasText && <del>{c.wasText}</del>}
      </span>
      {c.percent != null && <span className="product-card__off">{formatSaleBadge(c.percent)}</span>}
    </div>
  );
  // A failed srcset candidate first falls back to the plain src (with a srcset the browser ignores src), then to
  // the placeholder, as ProductImage does.
  const img = (src: string, srcset?: string) => (
    <img
      src={src || PLACEHOLDER}
      srcSet={srcset || undefined}
      sizes={srcset ? WISHLIST_SIZES : undefined}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget as HTMLImageElement;
        if (el.hasAttribute('srcset')) {
          el.removeAttribute('srcset');
          return;
        }
        if (!el.src.endsWith(PLACEHOLDER)) {
          el.src = PLACEHOLDER;
          el.onerror = null;
        }
      }}
    />
  );

  // Same anatomy as ProductCard (SPEC § Wall): image, label, title, subtitle, price; the heart removes the item.
  return (
    <div ref={root}>
    {status}
    <ul className="product-grid product-grid--wish">
      {stored.map((s, index) => {
        const c = fresh[s.id];
        // A successful fetch that omits an ATTEMPTED id means the product was unpublished/deleted —
        // show it as unavailable (no dead link to a 404 PDP). Ids past the cap weren't attempted,
        // so they keep their stored snapshot rather than being mislabeled gone.
        const gone = fetchOk && attempted.has(s.id) && !c;
        const name = c?.name || s.name;
        const image = c?.image || s.image;
        const srcset = c?.image ? c.srcset : undefined; // the stored snapshot has no srcset
        // the stored snapshot has no tile fill either: none. Same attributes as ProductCard's tile.
        const tileBg = c?.image ? cardFillProps(c.photoFill) : {};
        // A snapshot saved before the live-URL switch has no path: the legacy /vara/<slug>/ route 301s to the product.
        const href = c?.path ?? s.path ?? `/vara/${encodeURIComponent(s.slug)}/`;
        const label = gone ? { text: 'Ekki í boði', tone: 'muted' } : c ? cardLabel({ discounted: c.percent != null, outOfStock: Boolean(c.outOfStock) }) : null;
        const removeBtn = (
          <button className="wish-btn" type="button" onClick={() => remove(s.id, name, index)} aria-label={`Fjarlægja „${name}“ af óskalista`}>
            {heartIcon}
          </button>
        );

        return (
          <li key={s.id}>
            <div className={gone ? 'product-card-wrap wish-gone' : 'product-card-wrap'}>
              <div className="product-card">
                {gone ? (
                  <div className="product-card__media" {...tileBg}>{img(image, srcset)}</div>
                ) : (
                  <a className="product-card__media" href={href} tabIndex={-1} aria-hidden="true" {...tileBg}>
                    {img(image, srcset)}
                  </a>
                )}
                <div className="product-card__caption">
                  {label && <span className={`product-card__label product-card__label--${label.tone}`}>{label.text}</span>}
                  <h3 className="product-card__title">{gone ? name : <a href={href}>{name}</a>}</h3>
                  {gone ? (
                    <span className="product-card__cats">Ekki lengur fáanleg</span>
                  ) : (
                    c?.subtitle && <span className="product-card__cats">{c.subtitle}</span>
                  )}
                  {!gone && c?.priceText && <div className="product-card__after">{priceLine(c)}</div>}
                </div>
              </div>
              {removeBtn}
            </div>
          </li>
        );
      })}
    </ul>
    </div>
  );
}
