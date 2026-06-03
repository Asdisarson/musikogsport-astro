import { useEffect, useState } from 'react';
import { splitBrand } from '../lib/brand';
import { PLACEHOLDER } from '../lib/img';

export interface RecentItem {
  id: number;
  slug: string;
  name: string;
  image: string;
  // A single current price hint only. Sale badges / "was" prices and stock state are
  // deliberately NOT stored — a localStorage snapshot would go stale and misrepresent a
  // discount or availability that has since changed. The card links to the live PDP.
  priceText: string;
}

const KEY = 'mos-recent';
const CAP = 12;

function readStore(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries (storage shape can drift across deploys).
    return parsed.filter(
      (x): x is RecentItem => x && typeof x.id === 'number' && typeof x.slug === 'string' && typeof x.name === 'string',
    );
  } catch {
    return [];
  }
}

interface Props {
  /** When present (on a PDP), record this product and exclude it from the strip. */
  current?: RecentItem;
  title?: string;
  eyebrow?: string;
}

// Client-only "Nýlega skoðað" strip backed by localStorage. Renders nothing until
// mounted (so SSR and first client render agree) and nothing when there's no history.
export default function RecentlyViewed({ current, title = 'Nýlega skoðað', eyebrow = 'Heimsóknir þínar' }: Props) {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    let list = readStore();
    if (current && current.slug) {
      list = [current, ...list.filter((x) => x.id !== current.id)].slice(0, CAP);
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {
        /* private mode / quota — non-fatal */
      }
    }
    // Exclude the current product from what we display.
    setItems(current ? list.filter((x) => x.id !== current.id) : list.slice(0, CAP));
  }, [current?.id]);

  if (items.length === 0) return null;

  return (
    <section className="section--tight container container--wide recent">
      <div className="section__head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <ul className="product-grid">
        {items.map((it) => {
          const { brand, rest } = splitBrand(it.name);
          return (
            <li key={it.id}>
              <a className="product-card" href={`/vara/${it.slug}`}>
                <div className="product-card__media">
                  <img
                    src={it.image || PLACEHOLDER}
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
                  <div className="product-card__quick">
                    <span className="pill">
                      Skoða
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M7 17 17 7" />
                        <path d="M8 7h9v9" />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="product-card__body">
                  {brand && <span className="product-card__brand">{brand}</span>}
                  <h3 className="product-card__title">{rest}</h3>
                  {it.priceText && <span className="price">{it.priceText}</span>}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
