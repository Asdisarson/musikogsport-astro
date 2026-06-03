import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { addToCart, cartError, openCart } from '../lib/cartStore';
import { formatISK } from '../lib/format';
import { PLACEHOLDER } from '../lib/img';
import WaitlistForm from './WaitlistForm';

interface VarAttr {
  name: string;
  options: string[];
}
interface Variation {
  id: number;
  attributes: { name: string; option: string }[];
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock_status: string;
  image?: { src: string; alt: string } | null;
}
interface Props {
  productId: number;
  type: string;
  inStock: boolean;
  variationAttrs?: VarAttr[];
  variations?: Variation[];
  variationsFailed?: boolean;
  /** Product's default/gallery image — restored when a selected variation has no own image. */
  baseImage?: { src: string; alt: string };
}

export default function ProductPurchase({
  productId,
  type,
  inStock,
  variationAttrs = [],
  variations = [],
  variationsFailed = false,
  baseImage,
}: Props) {
  const isVariable = type === 'variable';
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const err = useStore(cartError);

  const allChosen = !isVariable || variationAttrs.every((a) => selected[a.name]);

  const resolved = useMemo<Variation | null>(() => {
    if (!isVariable || !allChosen) return null;
    return (
      variations.find((v) =>
        variationAttrs.every((a) => {
          const va = v.attributes.find((x) => x.name === a.name);
          // Require the attribute to exist; empty option means "any" (wildcard).
          return va !== undefined && (va.option === '' || va.option === selected[a.name]);
        }),
      ) ?? null
    );
  }, [selected, isVariable, allChosen, variationAttrs, variations]);

  // Swap the PDP main image to the selected variation's own image, or restore the base
  // image when the selection has none (so switching A→B never leaves A's photo showing).
  // Keeps the gallery thumbnail highlight in sync. Mirrors Base.astro's thumbnail swap.
  useEffect(() => {
    if (!isVariable) return;
    const main = document.getElementById('pdp-main') as HTMLImageElement | null;
    if (!main) return;
    const target = resolved?.image?.src ? resolved.image : baseImage;
    if (!target?.src) return;
    // Re-arm the placeholder fallback — ProductImage's inline onerror is one-shot and
    // self-disarms, so a second failed swap would otherwise show a broken image.
    main.onerror = () => {
      if (!main.src.endsWith(PLACEHOLDER)) {
        main.src = PLACEHOLDER;
        main.onerror = null;
      }
    };
    main.src = target.src;
    if (target.alt) main.alt = target.alt;
    document.querySelectorAll<HTMLElement>('.pdp__thumb').forEach((o) => {
      if (o.dataset.full === target.src) o.setAttribute('aria-current', 'true');
      else o.removeAttribute('aria-current');
    });
  }, [resolved?.id]);

  const activeStock = isVariable ? resolved?.stock_status ?? 'outofstock' : inStock ? 'instock' : 'outofstock';
  const canAdd = (isVariable ? Boolean(resolved && resolved.stock_status === 'instock') : inStock) && !adding;
  // Show the back-in-stock waitlist when the active selection is out of stock
  // (a chosen variation, or a simple product). Variable products need a selection first.
  const showWaitlist = isVariable ? Boolean(resolved && resolved.stock_status !== 'instock') : !inStock;
  const waitlistVariationId = isVariable ? resolved?.id : undefined;

  async function handleAdd() {
    setAdding(true);
    setJustAdded(false);
    try {
      const variation =
        isVariable && resolved ? variationAttrs.map((a) => ({ attribute: a.name, value: selected[a.name] })) : undefined;
      await addToCart(productId, qty, variation);
      setJustAdded(true);
      openCart();
    } catch {
      /* error surfaced via cartError */
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      {isVariable && variationsFailed && (
        <p className="form-error">Gat ekki sótt afbrigði vörunnar. Reyndu aftur síðar.</p>
      )}
      {isVariable && !variationsFailed &&
        variationAttrs.map((a) => (
          <div className="field" key={a.name}>
            <span className="field__label">{a.name}</span>
            <div className="swatches">
              {a.options.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  className="swatch"
                  aria-label={`${a.name}: ${opt}`}
                  aria-pressed={selected[a.name] === opt}
                  onClick={() => {
                    setSelected((s) => ({ ...s, [a.name]: opt }));
                    setJustAdded(false);
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}

      {isVariable && resolved && (
        <p className="pdp__price">
          {formatISK(resolved.on_sale && resolved.sale_price ? resolved.sale_price : resolved.price)}
          {resolved.on_sale && resolved.regular_price && (
            <span className="price__was">{formatISK(resolved.regular_price)}</span>
          )}
        </p>
      )}

      <p className={`stock ${activeStock === 'instock' ? 'stock--in' : 'stock--out'}`}>
        {activeStock === 'instock' ? 'Til á lager' : isVariable && !allChosen ? 'Veldu valkost' : 'Uppselt'}
      </p>

      {showWaitlist ? (
        <WaitlistForm productId={productId} variationId={waitlistVariationId} />
      ) : (
        <div className="add-row">
          <div className="qty">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fækka">−</button>
            <input value={qty} readOnly aria-label="Fjöldi" />
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Fjölga">+</button>
          </div>
          <button type="button" className="btn btn--accent btn--lg" disabled={!canAdd} onClick={handleAdd}>
            {adding ? 'Bæti við…' : justAdded ? 'Bætt í körfu ✓' : 'Setja í körfu'}
          </button>
        </div>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">{justAdded ? 'Vara sett í körfu.' : ''}</p>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
