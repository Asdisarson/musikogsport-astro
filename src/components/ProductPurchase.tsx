import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { addToCart, openCart } from '../lib/cartStore';
import { formatISK } from '../lib/format';
import { PLACEHOLDER } from '../lib/img';
import { applyPhotoFit, photoBgProps, type PhotoFit } from '../lib/photoBg';
import { isColourAttribute } from '../lib/productCard';
import { choiceHint, isSizeAttribute, optionImages, optionState, resolveVariation } from '../lib/variations';
import { qtyFromInput } from '../lib/validate';
import { gridStep } from '../lib/gridNav';
import type { PdpVariation } from '../lib/types';

// The add-to-cart form (nike-look, SPEC § PDP; WooCommerce + Variation Swatches semantics): per attribute a label
// row ("Veldu stærð" with the size-chart link at right for a size, else the attribute's name and the chosen value),
// then radio-like buttons — colours as picture thumbs when every colour has its own photo, everything else as a
// 2-column grid of 48px boxes with sold-out options struck through. Arrow keys move between the options. Then a
// "Hreinsa" reset, the variation's stock, a quiet quantity box on its own line, and "Setja í körfu" as a full-width
// pill (disabled, with a "Veldu stærð" hint under it, until a size is chosen).

interface VarAttr {
  name: string;
  options: string[];
}

interface Props {
  productId: number;
  type: string;
  inStock: boolean;
  variationAttrs?: VarAttr[];
  variations?: PdpVariation[];
  variationsFailed?: boolean;
  /** Product's own first image and SKU — restored when a selection is cleared or has none of its own. */
  baseImage?: { src: string; alt: string };
  baseSku?: string;
  /** Woo shows a separate variation price only when variation prices differ. */
  priceVaries?: boolean;
  /** Tile colours (lib/photoBg) of the colourway swatch photos, by src. A photo missing here keeps the default tile. */
  photoBgs?: Record<string, string>;
  /** How #pdp-main's tile draws each photo it may swap in (lib/photoBg photoFit), by src; missing: the default tile. */
  mainFits?: Record<string, PhotoFit>;
  /** #pdp-main's tile shape on a desktop for each of those photos (lib/photoBg tileAspect), by src; missing: 4:5. */
  mainAspects?: Record<string, number>;
  /** The "Stærðartafla" link (Astro's named slot `size-guide`), shown beside the first size attribute's label. */
  sizeGuide?: ReactNode;
}

/** Arrow keys move focus between a group's options (Up/Down by a row of the grid), skipping sold-out (disabled)
 *  ones (gridStep). Enter/Space pick. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const list = e.currentTarget;
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const cols = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const to = gridStep(at, e.key, cols, buttons.map((b) => b.disabled));
  e.preventDefault();
  if (to !== at) buttons[to].focus();
}

const Minus = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

export default function ProductPurchase({
  productId,
  type,
  inStock,
  variationAttrs = [],
  variations = [],
  variationsFailed = false,
  baseImage,
  baseSku,
  priceVaries = false,
  photoBgs = {},
  mainFits = {},
  mainAspects = {},
  sizeGuide,
}: Props) {
  const isVariable = type === 'variable';
  const [selected, setSelected] = useState<Record<string, string>>({});
  // The field's raw text, so clearing it to type a new number works; read through qtyFromInput.
  const [qtyText, setQtyText] = useState('1');
  const qty = qtyFromInput(qtyText);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // Only this button's own failure shows here; a card's add elsewhere on the page reports in the side cart.
  const [err, setErr] = useState<string | null>(null);

  const attrNames = useMemo(() => variationAttrs.map((a) => a.name), [variationAttrs]);
  const resolved = useMemo(
    () => (isVariable ? resolveVariation(variations, attrNames, selected) : null),
    [isVariable, variations, attrNames, selected],
  );
  const anySelected = Object.values(selected).some(Boolean);
  // Display only: a colour attribute (the colourway row) comes first; attrNames keeps WooCommerce's order.
  const shown = useMemo(
    () => variationAttrs.map((a, i) => ({ a, i })).sort((x, y) => Number(isColourAttribute(y.a.name)) - Number(isColourAttribute(x.a.name))),
    [variationAttrs],
  );
  const pictures = useMemo(
    () => new Map(variationAttrs.filter((a) => isColourAttribute(a.name)).map((a) => [a.name, optionImages(a.name, a.options, variations)])),
    [variationAttrs, variations],
  );
  const sizeGuideFor = variationAttrs.find((a) => isSizeAttribute(a.name))?.name;

  // Like Woo's variation form: the first gallery image and the SKU follow the chosen variation.
  useEffect(() => {
    if (!isVariable) return;
    const sku = document.querySelector<HTMLElement>('[data-pdp-sku]');
    if (sku) sku.textContent = resolved?.sku || baseSku || '';
    const main = document.getElementById('pdp-main') as HTMLImageElement | null;
    const target = resolved?.image?.src ? resolved.image : baseImage;
    if (!main || !target?.src) return;
    // Re-arm the placeholder fallback for the new photo: /img-fallback.js handles each image once (it drops
    // data-fallback after swapping in the placeholder), so a variation photo that fails later needs its own handler.
    // A property set from script, not an inline attribute, so an enforced CSP allows it.
    main.onerror = () => {
      if (!main.src.endsWith(PLACEHOLDER)) {
        main.src = PLACEHOLDER;
        main.onerror = null;
      }
    };
    const swapped = main.src !== new URL(target.src, location.href).href;
    main.src = target.src;
    if (target.alt) main.alt = target.alt;
    // a carousel (phones, the shoe viewer) brings a new photo into view; picking a size alone leaves it be
    if (swapped) main.closest<HTMLElement>('[data-gallery-track]')?.scrollTo({ left: 0 });
    const tile = main.closest<HTMLElement>('[data-lightbox]');
    if (tile) {
      applyPhotoFit(tile, mainFits[target.src]);
      const aspect = mainAspects[target.src];
      if (aspect) tile.style.setProperty('--tile-aspect', String(aspect));
      else tile.style.removeProperty('--tile-aspect');
    }
  }, [resolved?.id]);

  const canAdd = (isVariable ? resolved?.stock_status === 'instock' : inStock) && !adding;
  // Render-only guidance beside the disabled button until every attribute is chosen ("Veldu stærð").
  // Only when the missing attribute has an option left to pick: a hint over all-crossed-out swatches can't be acted on.
  const hint = isVariable && !variationsFailed ? choiceHint(attrNames, selected, { attrs: variationAttrs, variations }) : null;
  const hintId = `pdp-hint-${productId}`;

  function choose(name: string, option: string) {
    setSelected((s) => ({ ...s, [name]: s[name] === option ? '' : option }));
    setJustAdded(false);
  }

  async function handleAdd() {
    if (!canAdd) return;
    setAdding(true);
    setJustAdded(false);
    setErr(null);
    try {
      // By variation id: an "any size" variation can't be found again from the attributes alone (Woo may
      // pick a sold-out exact one). Its wildcard attributes still need the chosen values.
      const variation = isVariable && resolved ? attrNames.map((n) => ({ attribute: n, value: selected[n] })) : undefined;
      setQtyText(String(qty));
      await addToCart(isVariable && resolved ? resolved.id : productId, qty, variation);
      setJustAdded(true);
      openCart();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Villa kom upp.');
    } finally {
      setAdding(false);
    }
  }

  const price = (v: PdpVariation) =>
    v.on_sale && v.sale_price ? (
      <>
        <ins>{formatISK(v.sale_price)}</ins> <del>{formatISK(v.regular_price)}</del>
      </>
    ) : (
      formatISK(v.price)
    );

  return (
    <div className="pdp-buy">
      {isVariable && variationsFailed && <p className="form-error">Gat ekki sótt afbrigði vörunnar. Reyndu aftur síðar.</p>}

      {isVariable && !variationsFailed && (
        <div className="pdp-vars">
          {shown.map(({ a, i: ai }) => {
            const size = isSizeAttribute(a.name);
            const images = pictures.get(a.name) ?? null;
            return (
              <div className="pdp-var" key={a.name}>
                <div className="pdp-var__head">
                  <div className="pdp-var__label" id={`pdp-var-${ai}`}>
                    {size ? (
                      'Veldu stærð'
                    ) : (
                      <>
                        {a.name}
                        {selected[a.name] && (
                          <>
                            :{' '}<span className="pdp-var__value">{selected[a.name]}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {a.name === sizeGuideFor && sizeGuide}
                </div>
                <ul className={`pdp-swatches${images ? ' pdp-swatches--images' : ''}`} role="radiogroup" aria-labelledby={`pdp-var-${ai}`} onKeyDown={moveFocus}>
                  {a.options.map((opt) => {
                    const state = optionState(variations, a.name, opt, selected, attrNames);
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          className={`pdp-swatch${images ? ' pdp-swatch--image' : ''}`}
                          role="radio"
                          aria-checked={selected[a.name] === opt}
                          aria-label={state === 'instock' ? opt : `${opt} — uppselt`}
                          data-state={state}
                          disabled={state !== 'instock'}
                          onClick={() => choose(a.name, opt)}
                          {...(images ? photoBgProps(photoBgs[images[opt]]) : {})}
                        >
                          {images ? <img src={images[opt]} alt="" width={60} height={60} loading="lazy" decoding="async" /> : opt}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <button type="button" className="pdp-reset" data-visible={anySelected ? 'true' : 'false'} onClick={() => setSelected({})}>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15 9-6 6M9 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            Hreinsa
          </button>
        </div>
      )}

      {isVariable && resolved && (
        <div className="pdp-variation">
          {priceVaries && <p className="pdp-variation__price price">{price(resolved)}</p>}
          <p className={`pdp-stock pdp-stock--${resolved.stock_status === 'instock' ? 'in' : 'out'}`}>
            {resolved.stock_status === 'instock' ? 'Á lager' : 'Uppselt'}
          </p>
        </div>
      )}
      {!isVariable && !inStock && (
        <div className="pdp-variation">
          <p className="pdp-stock pdp-stock--out">Uppselt</p>
        </div>
      )}

      <div className="pdp-cart">
        <div className="pdp-qty" role="group" aria-label="Fjöldi">
          <button type="button" onClick={() => setQtyText(String(Math.max(1, qty - 1)))} aria-label="Fækka">
            <Minus />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => setQtyText(String(qty))}
            aria-label="Fjöldi"
          />
          <button type="button" onClick={() => setQtyText(String(qtyFromInput(String(qty + 1))))} aria-label="Fjölga">
            <Plus />
          </button>
        </div>
        <button
          type="button"
          className="pdp-atc"
          disabled={!canAdd}
          aria-busy={adding}
          aria-describedby={hint ? hintId : undefined}
          onClick={handleAdd}
        >
          Setja í körfu
        </button>
      </div>
      {hint && (
        <p className="pdp-hint" id={hintId}>
          {hint}
        </p>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {justAdded ? 'Vara sett í körfu.' : ''}
      </p>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
