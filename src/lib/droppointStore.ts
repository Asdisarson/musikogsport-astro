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

/** True for shipping rates that require a parcel-locker selection (Pakki Póstbox). */
export function rateNeedsPostbox(rateId: string | undefined | null): boolean {
  return !!rateId && (rateId.startsWith('DPO') || rateId.startsWith('DNO'));
}
