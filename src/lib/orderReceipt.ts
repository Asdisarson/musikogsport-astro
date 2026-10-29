// The order-received page's decisions (PA-06), kept out of the .astro file so they can be tested. Pure.
import type { OrderLookup } from './woo';

/** The key the receipt asks WooCommerce with: the URL's (`?key=`, WooCommerce's own link), else the httpOnly
 *  checkout cookie when it names this order (a card return: the bridge strips the key). `placedHere`: this browser
 *  placed the order (the cookie matches), whichever key is used. */
export function receiptKey(
  id: number,
  queryKey: string | null,
  cookie: { id: number; key: string } | null,
): { key: string; placedHere: boolean } {
  const placedHere = cookie !== null && cookie.id === id;
  return { key: queryKey || (placedHere ? cookie.key : ''), placedHere };
}

/** 200 only for a verified order; a miss (wrong key, no such order, no key at all) is 404, an outage 503. */
export function receiptStatus(state: OrderLookup['state']): 200 | 404 | 503 {
  return state === 'found' ? 200 : state === 'not-found' ? 404 : 503;
}

/** Copy for a receipt that can't be shown. Neutral: a real shopper can land here without the checkout cookie (another
 *  browser, cookies cleared, more than 2 h later), so it points at the confirmation e-mail and never claims either
 *  that the order went through or that it didn't. */
export const RECEIPT_NOTICE = {
  'not-found': {
    title: 'Pöntunin fannst ekki.',
    body: 'Við getum ekki birt pöntun með þessum upplýsingum. Ef þú varst að ganga frá pöntun færðu staðfestingu í tölvupósti með öllum upplýsingum um hana.',
  },
  unavailable: {
    title: 'Ekki tókst að sækja pöntunina.',
    body: 'Reyndu aftur eftir smástund. Staðfesting á pöntun berst einnig í tölvupósti.',
  },
} as const;
