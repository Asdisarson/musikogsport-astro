import { useEffect, useState } from 'react';
import { splitBrand } from '../lib/brand';
import { PLACEHOLDER } from '../lib/img';
import { WISHLIST_MAX_IDS } from '../lib/wishlist';
import type { ProductSummary } from '../lib/types';

// localStorage persistence shape — hearts store only this minimal snapshot (the live card,
// with price/stock, is the fetched ProductSummary below).
interface Stored {
  id: number;
  slug: string;
  name: string;
  image: string;
}

const WKEY = 'mos-wishlist';

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

  function remove(id: number) {
    const next = readStore().filter((x) => x.id !== id);
    try {
      localStorage.setItem(WKEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('mos:wishlist')); // header count re-syncs
    setStored(next);
  }

  if (!ready) return <p className="muted">Sæki óskalista…</p>;

  if (stored.length === 0) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <p className="muted" style={{ marginBottom: '1rem' }}>Óskalistinn þinn er tómur.</p>
        <a className="btn btn--accent" href="/verslun">Skoða vörur</a>
      </div>
    );
  }

  const heartIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.3 10.55 19C5.4 14.24 2 11.16 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.66-3.4 6.74-8.55 11.5L12 20.3Z" />
    </svg>
  );
  // Render the price, splitting any "frá " prefix into the muted .price__from span so it
  // matches PriceTag on every other card surface (rather than bold-display the whole string).
  const priceEl = (text: string) =>
    text.startsWith('frá ') ? (
      <span className="price">
        <span className="price__from">frá </span>
        {text.slice(4)}
      </span>
    ) : (
      <span className="price">{text}</span>
    );
  const img = (src: string) => (
    <img
      src={src || PLACEHOLDER}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget as HTMLImageElement;
        if (!el.src.endsWith(PLACEHOLDER)) {
          el.src = PLACEHOLDER;
          el.onerror = null;
        }
      }}
    />
  );

  return (
    <ul className="product-grid">
      {stored.map((s) => {
        const c = fresh[s.id];
        // A successful fetch that omits an ATTEMPTED id means the product was unpublished/deleted —
        // show it as unavailable (no dead link to a 404 PDP). Ids past the cap weren't attempted,
        // so they keep their stored snapshot rather than being mislabeled gone.
        const gone = fetchOk && attempted.has(s.id) && !c;
        const name = c?.name || s.name;
        const { brand, rest } = splitBrand(name);
        const image = c?.image || s.image;
        const removeBtn = (
          <button
            className="wish-btn"
            type="button"
            aria-pressed="true"
            onClick={() => remove(s.id)}
            aria-label={`Fjarlægja „${name}“ af óskalista`}
          >
            {heartIcon}
          </button>
        );

        if (gone) {
          return (
            <li key={s.id}>
              <div className="product-card-wrap wish-gone">
                <div className="product-card">
                  <div className="product-card__media">
                    {img(image)}
                    <span className="badge badge--muted">Ekki í boði</span>
                  </div>
                  <div className="product-card__body">
                    {brand && <span className="product-card__brand">{brand}</span>}
                    <h3 className="product-card__title">{rest}</h3>
                    <span className="muted wish-gone__note">Ekki lengur fáanleg</span>
                  </div>
                </div>
                {removeBtn}
              </div>
            </li>
          );
        }

        return (
          <li key={s.id}>
            <div className="product-card-wrap">
              <a className="product-card" href={`/vara/${s.slug}`}>
                <div className="product-card__media">
                  {img(image)}
                  {c?.outOfStock && <span className="badge badge--muted">Uppselt</span>}
                  {c && !c.outOfStock && c.onSale && <span className="badge badge--sale">Tilboð</span>}
                </div>
                <div className="product-card__body">
                  {brand && <span className="product-card__brand">{brand}</span>}
                  <h3 className="product-card__title">{rest}</h3>
                  {c?.priceText && priceEl(c.priceText)}
                </div>
              </a>
              {removeBtn}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
