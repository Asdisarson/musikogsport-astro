import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import { addToCart, cart, ensureLoaded, openCart } from '../lib/cartStore';
import { cappedIds, inCartAmong, inCartQty, remainingFor } from '../lib/cartQty';
import { buyable, clampQty, stockLabel } from '../lib/livePrices';
import { liveStore, productSoldOne, productStock, productStockMax, retryLive, startLive, withLive } from '../lib/liveStore';
import { formatISK } from '../lib/format';
import { gridStep } from '../lib/gridNav';
import { mainSources } from '../lib/img';
import { applyPhotoFit, photoBgProps, type PhotoFit } from '../lib/photoBg';
import { isColourAttribute } from '../lib/productCard';
import { choiceHint, isSizeAttribute, nothingToBuy, optionImages, optionState, resolveVariation, waitlistDuring, waitlistTarget } from '../lib/variations';
import { qtyFromInput } from '../lib/validate';
import type { PdpVariation } from '../lib/types';
import WaitlistForm from './WaitlistForm';

// The add-to-cart form (nike-look, SPEC § PDP; WooCommerce + Variation Swatches semantics): per attribute a label
// row ("Veldu stærð" with the size-chart link at right for a size, else the attribute's name and the chosen value),
// then radio-like buttons — colours as picture thumbs when every colour has its own photo, everything else as a
// 2-column grid of 48px boxes with sold-out options struck through (still pickable: a sold-out choice shows the
// waitlist sign-up). Arrow keys move between the options. Then a "Hreinsa" reset, the variation's stock, a quiet
// quantity box on its own line, and "Setja í körfu" as a full-width pill (disabled, with a "Veldu stærð" hint under
// it, until a size is chosen). A choice known to be sold out gets the waitlist form (WaitlistForm) in their place.

interface VarAttr {
  name: string;
  options: string[];
}

interface Props {
  productId: number;
  type: string;
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
  /** The product's name, for the phone's bottom bar. */
  name?: string;
  /** The "Stærðartafla" link (Astro's named slot `size-guide`), shown beside the first size attribute's label. */
  sizeGuide?: ReactNode;
}

/** Arrow keys move focus between a group's options (Up/Down by a row of the grid), skipping disabled ones: the
 *  combinations that don't exist (gridStep). Enter/Space pick. */
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

/** The stock line in its three states. Pending keeps the same height (no layout shift) and says nothing; failed says so
 *  with a retry; a known answer is "Á lager" or "Uppselt" through stockLabel (the one backorder rule). */
function StockLine({ state, stock, hasChoice }: { state: 'pending' | 'ready' | 'failed'; stock: string | null | undefined; hasChoice: boolean }) {
  if (state === 'failed') {
    return (
      <div className="pdp-variation">
        <p className="pdp-stock pdp-stock--unknown" role="status">
          Gat ekki sótt lagerstöðu{' '}
          <button type="button" className="pdp-stock__retry" onClick={retryLive}>Reyna aftur</button>
        </p>
      </div>
    );
  }
  if (!hasChoice) return <div className="pdp-variation pdp-stock-slot" aria-hidden="true"><p className="pdp-stock pdp-stock--pending">&nbsp;</p></div>;
  const label = state === 'ready' && stock !== undefined ? stockLabel(stock as 'instock' | null) : null;
  return (
    <div className="pdp-variation">
      {label ? (
        <p className={`pdp-stock pdp-stock--${label === 'Á lager' ? 'in' : 'out'}`}>{label}</p>
      ) : (
        <p className="pdp-stock pdp-stock--pending" aria-hidden="true">&nbsp;</p>
      )}
    </div>
  );
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
  variationAttrs = [],
  variations = [],
  variationsFailed = false,
  baseImage,
  baseSku,
  priceVaries = false,
  photoBgs = {},
  mainFits = {},
  mainAspects = {},
  name = '',
  sizeGuide,
}: Props) {
  const isVariable = type === 'variable';
  // Stock and the corrected prices come from the live answer, never from the page (see lib/liveStore).
  const live = useStore(liveStore);
  useEffect(() => startLive(productId), [productId]);
  const liveVars = useMemo(() => variations.map((v) => withLive(v, live.state === 'ready' ? live.variations : undefined)), [variations, live]);
  // The variations managed by their parent's stock (from the live answer): they share that stock, so their cart lines count together.
  const parentShared = useMemo(
    () => (live.state === 'ready' ? Object.values(live.variations ?? {}).filter((v) => v.sharedStock).map((v) => v.id) : []),
    [live],
  );
  // The product's own stock: undefined while pending, null once failed (no guess either way).
  const simpleStock = productStock(live);
  const simpleStockMax = productStockMax(live);
  const simpleSoldOne = productSoldOne(live);
  const [selected, setSelected] = useState<Record<string, string>>({});
  // The field's raw text, so clearing it to type a new number works; read through qtyFromInput.
  const [qtyText, setQtyText] = useState('1');
  // The cart's own lines: what is already in it counts against the live cap (a rise or fall updates this page).
  const cartNow = useStore(cart);
  useEffect(() => ensureLoaded(), []);
  const qty = qtyFromInput(qtyText);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // Only this button's own failure shows here; a card's add elsewhere on the page reports in the side cart.
  const [err, setErr] = useState<string | null>(null);
  // "Setja í körfu" pressed before a size was picked: the hint turns into an error and the group is marked
  const [nudged, setNudged] = useState(false);
  const varsRef = useRef<HTMLDivElement>(null);
  // the phone bar's ×: hidden for the variation it was closed on; picking another brings it back
  const [barClosedFor, setBarClosedFor] = useState<number | null>(null);
  // ...and it only shows while the form's own "Setja í körfu" is out of sight
  const cartRef = useRef<HTMLDivElement>(null);
  const [cartInView, setCartInView] = useState(true);
  useEffect(() => {
    const el = cartRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setCartInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const attrNames = useMemo(() => variationAttrs.map((a) => a.name), [variationAttrs]);
  const resolved = useMemo(
    () => (isVariable ? resolveVariation(liveVars, attrNames, selected) : null),
    [isVariable, liveVars, attrNames, selected],
  );
  const anySelected = Object.values(selected).some(Boolean);
  // Display only: a colour attribute (the colourway row) comes first; attrNames keeps WooCommerce's order.
  const shown = useMemo(
    () => variationAttrs.map((a, i) => ({ a, i })).sort((x, y) => Number(isColourAttribute(y.a.name)) - Number(isColourAttribute(x.a.name))),
    [variationAttrs],
  );
  const pictures = useMemo(
    () => new Map(variationAttrs.filter((a) => isColourAttribute(a.name)).map((a) => [a.name, optionImages(a.name, a.options, liveVars)])),
    [variationAttrs, liveVars],
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
    // The new photo gets the shared fallback (public/img-fallback.js, one path for every product photo): its
    // data-fallback is set again (the script drops it after a placeholder) and its per-image state is cleared. A
    // property handler here would run on the same error as the script and decide the photo a second time.
    // The photo's AVIF/WebP <source>s sit before the <img> and win over its `src`: the script drops a failed one first.
    const picture = main.parentElement?.tagName === 'PICTURE' ? main.parentElement : null;
    const dropSources = () => {
      const sources = picture ? [...picture.querySelectorAll('source')] : [];
      sources.forEach((s) => s.remove());
      return sources.length > 0;
    };
    main.setAttribute('data-fallback', '');
    main.removeAttribute('data-reloaded');
    main.removeAttribute('data-probing');
    const swapped = main.src !== new URL(target.src, location.href).href;
    if (swapped && picture) {
      // The sources must follow the swap, or the browser keeps showing the previous photo's.
      dropSources();
      const light = mainSources(target.src);
      if (light) {
        for (const [type, srcset] of [['image/avif', light.avif], ['image/webp', light.webp]] as const) {
          const source = document.createElement('source');
          source.type = type;
          source.srcset = srcset;
          picture.insertBefore(source, main);
        }
      }
    }
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

  // The stock this selection shows: a variation's, or the product's. undefined = not known yet (pending or failed).
  const stock = isVariable ? resolved?.stock_status : simpleStock;
  const known = stock !== undefined && stock !== null;
  // The stock cap of this selection (live only): null while pending, failed, or not managed. Stock is never kept from an
  // earlier answer, so a pending refetch leaves no cap rather than a stale one (WooCommerce checks on add).
  const cap = (isVariable ? resolved?.stockMax : simpleStockMax) ?? null;
  // Sold individually counts the chosen variation's own cart lines alone (one per line); the stock cap counts every
  // line that draws on the same stock, including the sibling variations that share the parent's (cappedIds).
  const soldOne = (isVariable ? resolved?.soldOne : simpleSoldOne) === true;
  const own = isVariable ? (resolved?.id ?? null) : productId;
  const inCart = own === null ? 0 : inCartAmong(cartNow?.items ?? [], cappedIds(own, parentShared));
  const remaining = remainingFor(cap, inCart, soldOne, own === null ? 0 : inCartQty(cartNow?.items ?? [], own));
  // Nothing more can be added: the counter shows 1 and the button is off.
  const none = remaining === 0;
  const limit = remaining === null ? null : Math.max(1, remaining);
  const addQty = limit === null ? qty : Math.min(qty, limit);
  const atMax = limit !== null && qty >= limit;
  // The cap moved under the counter (another variation, or the answer came in): hold the value under it.
  useEffect(() => {
    if (limit !== null && qty > limit) setQtyText(String(limit));
  }, [limit, qty]);
  // Pending stays pressable: WooCommerce checks stock when the item is added. Only a known sold-out choice is blocked.
  const pending = live.state === 'pending' && (!isVariable || !!resolved);
  // No variation chosen, yet the live answer says nothing of this product can be bought (the product or every variation
  // is sold out): the selection is sold out too. Without this the button would add the parent with no variation and
  // WooCommerce's English error would show. Pending or failed answers never get here (nothingToBuy needs known stock).
  const sellsNothing = isVariable && live.state === 'ready' && !resolved && nothingToBuy(productStock(live), liveVars.map((v) => v.stock_status));
  // A known sold-out choice, or one with nothing to buy: nothing to count, so the quantity box is not shown at all.
  const soldOut = (known && !buyable(stock as 'instock')) || sellsNothing;
  const canAdd = !adding && !none && !soldOut;
  // A choice known to be sold out: the product (or exact variation) whose waitlist the sign-up joins, in place of the
  // quantity box and "Setja í körfu". A variable product needs its variation chosen first (the hint asks for it).
  // The answer is fetched again when the tab comes back (startLive): the form stays for the same choice meanwhile.
  const waitNow = waitlistTarget(isVariable, productId, simpleStock, resolved);
  const waitKnown = useRef<number | null>(null);
  useEffect(() => {
    if (live.state !== 'pending') waitKnown.current = waitNow;
  }, [live.state, waitNow]);
  const waitFor = waitlistDuring(live.state === 'pending', waitNow, waitKnown.current, own);
  // The quantity box and "Setja í körfu" give way to the form, or to the hint asking what to wait for.
  const noCart = soldOut || waitFor !== null;
  // Guidance under the button until every attribute is chosen ("Veldu stærð"); the button stays pressable then and
  // points at the missing choice instead of doing nothing.
  // Only when the missing attribute has an option left to pick. With nothing to buy, the choice is what to wait for.
  const pick = isVariable && !variationsFailed ? choiceHint(attrNames, selected, { attrs: variationAttrs, variations: liveVars }) : null;
  const hint = pick && sellsNothing ? `${pick} til að skrá þig á biðlista` : pick;
  const hintId = `pdp-hint-${productId}`;
  // Phones: a bottom bar with "Setja í körfu" once every option is picked and that variation is in stock (never on a
  // simple product), sliding in while the form's own button is out of sight
  // Never beside the waitlist form: while a refetch is pending the stock is unknown again, yet the choice is sold out.
  const barReady = isVariable && !!resolved && waitFor === null && attrNames.every((n) => selected[n]) && barClosedFor !== resolved.id && (resolved.stock_status === undefined || buyable(resolved.stock_status as 'instock'));
  const missing = hint ? attrNames.find((n) => !selected[n]) : undefined;

  function choose(attr: string, option: string) {
    setSelected((s) => ({ ...s, [attr]: s[attr] === option ? '' : option }));
    setJustAdded(false);
    setNudged(false);
  }

  async function handleAdd() {
    if (missing !== undefined) {
      setNudged(true);
      const group = varsRef.current?.querySelector<HTMLElement>(`[data-var="${attrNames.indexOf(missing)}"]`);
      group?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      (group?.querySelector<HTMLButtonElement>('[data-state="instock"]') ?? group?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
      return;
    }
    if (!canAdd) return;
    setAdding(true);
    setJustAdded(false);
    setErr(null);
    try {
      // By variation id: an "any size" variation can't be found again from the attributes alone (Woo may
      // pick a sold-out exact one). Its wildcard attributes still need the chosen values.
      const variation = isVariable && resolved ? attrNames.map((n) => ({ attribute: n, value: selected[n] })) : undefined;
      setQtyText(String(addQty));
      await addToCart(isVariable && resolved ? resolved.id : productId, addQty, variation);
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
        <div className="pdp-vars" ref={varsRef}>
          {shown.map(({ a, i: ai }) => {
            const size = isSizeAttribute(a.name);
            const images = pictures.get(a.name) ?? null;
            return (
              <div className={`pdp-var${nudged && a.name === missing ? ' is-missing' : ''}`} key={a.name} data-var={attrNames.indexOf(a.name)}>
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
                    const state = optionState(liveVars, a.name, opt, selected, attrNames);
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          className={`pdp-swatch${images ? ' pdp-swatch--image' : ''}`}
                          role="radio"
                          aria-checked={selected[a.name] === opt}
                          aria-label={state === 'outofstock' ? `${opt} — uppselt` : opt}
                          data-state={state}
                          disabled={state === 'none'}
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
          <button type="button" className="pdp-reset" data-visible={anySelected ? 'true' : 'false'} onClick={() => {
              setSelected({});
              setJustAdded(false);
              setNudged(false);
            }}>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15 9-6 6M9 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            Hreinsa
          </button>
        </div>
      )}

      {isVariable && resolved && priceVaries && (
        <div className="pdp-variation">
          <p className="pdp-variation__price price">{price(resolved)}</p>
        </div>
      )}
      <StockLine state={live.state} stock={sellsNothing ? 'outofstock' : stock} hasChoice={!isVariable || !!resolved || sellsNothing} />

      <div className="pdp-cart" ref={cartRef}>
        {waitFor !== null && <WaitlistForm key={waitFor} productId={waitFor} />}
        {!noCart && <div className="pdp-qty" role="group" aria-label="Fjöldi">
          <button type="button" onClick={() => setQtyText(String(Math.max(1, qty - 1)))} aria-label="Fækka">
            <Minus />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={limit ?? undefined}
            value={qtyText}
            onChange={(e) => {
              // typed above the cap: held at the cap
              const typed = qtyFromInput(e.target.value);
              setQtyText(limit !== null && typed > limit ? String(limit) : e.target.value);
            }}
            onBlur={() => setQtyText(String(clampQty(qty, limit)))}
            aria-label="Fjöldi"
          />
          <button
            type="button"
            onClick={() => { if (!atMax) setQtyText(String(clampQty(qtyFromInput(String(qty + 1)), limit))); }}
            aria-disabled={atMax}
            aria-label={atMax ? 'Fjölga (hámarki náð)' : 'Fjölga'}
          >
            <Plus />
          </button>
        </div>}
        {/* Sold out: the waitlist form above takes its place, or (nothing chosen yet) the hint asks for a choice */}
        {!noCart && <button
          type="button"
          className="pdp-atc"
          disabled={!canAdd && missing === undefined}
          aria-busy={adding || pending}
          aria-describedby={hint ? hintId : undefined}
          onClick={handleAdd}
        >
          Setja í körfu
        </button>}
      </div>
      {hint && (
        <p className={`pdp-hint${nudged ? ' is-error' : ''}`} id={hintId} role={nudged ? 'alert' : undefined}>
          {hint}
        </p>
      )}

      {barReady && (
        <div className="pdp-bar" data-show={cartInView ? undefined : ''} inert={cartInView}>
          <div className="pdp-bar__text">
            <span className="pdp-bar__name">{name}</span>
            {resolved && <span className="pdp-bar__choice">{attrNames.map((n) => (isSizeAttribute(n) ? `Stærð ${selected[n]}` : selected[n])).join(' · ')}</span>}
          </div>
          <button type="button" className="pdp-atc pdp-bar__atc" disabled={!canAdd} aria-busy={adding || pending} onClick={handleAdd}>
            Setja í körfu
          </button>
          <button type="button" className="pdp-bar__close" aria-label="Fela" onClick={() => setBarClosedFor(resolved?.id ?? null)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {justAdded ? 'Vara sett í körfu.' : ''}
      </p>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
