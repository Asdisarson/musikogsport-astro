// Shared "chosen Pósturinn pickup locker" state, persisted across the cart → checkout
// navigation (localStorage). Only the postbox (DPO/DNO "Pakki Póstbox") method needs a
// locker choice; it's submitted as postis_dpo_postbox in the checkout body.
import { atom } from 'nanostores';

export interface Droppoint {
  postcode: string; // the postcode this locker was chosen for (choice is postcode-scoped)
  id: string; // deliveryServiceId, e.g. "DPO9552"
  name: string;
}

const KEY = 'mos-droppoint';

function load(): Droppoint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.id === 'string' && typeof d.postcode === 'string' && typeof d.name === 'string') {
      return d as Droppoint;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const droppoint = atom<Droppoint | null>(typeof localStorage !== 'undefined' ? load() : null);

export function setDroppoint(d: Droppoint | null): void {
  droppoint.set(d);
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---------- confirmed against Pósturinn's current list (CO-03) ----------
// A saved locker can be retired or renamed upstream. It counts for checkout only once the picker has fetched the
// lockers for the postcode and found it there (or the shopper picked it from that list). Until then, and while a
// fetch is in flight or after one failed, checkout asks for a locker.

/** The locker id last confirmed against the fetched list, or null. */
export const verifiedDroppoint = atom<string | null>(null);

/** A fetch of the lockers started (a new postcode): nothing is confirmed until it answers. */
export function startDroppointCheck(): void {
  verifiedDroppoint.set(null);
}

/** After a successful fetch for `postcode`: a saved locker for it that is still listed is confirmed; one that is no
 *  longer listed is cleared, so the shopper must choose again. A locker saved for another postcode is left alone. */
export function reconcileDroppoint(postcode: string, ids: string[]): void {
  const chosen = droppoint.get();
  if (!chosen || chosen.postcode !== postcode) {
    verifiedDroppoint.set(null);
    return;
  }
  if (ids.includes(chosen.id)) {
    verifiedDroppoint.set(chosen.id);
  } else {
    setDroppoint(null);
    verifiedDroppoint.set(null);
  }
}

/** The shopper picked a locker from the fetched list (or "— Veldu póstbox —": null). */
export function chooseDroppoint(postcode: string, item: { id: string; name: string } | null): void {
  setDroppoint(item ? { postcode, id: item.id, name: item.name } : null);
  verifiedDroppoint.set(item ? item.id : null);
}

/** Checkout's gate: a locker chosen for this postcode and confirmed in Pósturinn's current list. */
export function postboxReady(chosen: Droppoint | null, verified: string | null, postcode: string): boolean {
  return chosen !== null && chosen.postcode === postcode && verified === chosen.id;
}

/** True for shipping rates that require a parcel-locker selection (Pakki Póstbox). */
export function rateNeedsPostbox(rateId: string | undefined | null): boolean {
  // Only DPO exists: the Posturinn plugin folds the postbox service into a single
  // generic 'DPO' rate and DNO is disabled upstream (2026-06-16 audit A1). If a
  // DPT (Pakki Pakkaport) rate is ever enabled it must NOT reuse this flow — it
  // needs its own /parcelpoints picker and the postis_dpt_parcelpoints field.
  return !!rateId && rateId.startsWith('DPO');
}
