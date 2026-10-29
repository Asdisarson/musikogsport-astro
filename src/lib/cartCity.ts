import { decodeEntities } from './decode';

/** The cart's shipping town for display and the calculator's input. The Store API needs a non-empty town, so
 *  ShippingCalc sends '-' when none is given, and WooCommerce hands it back as a dash (often the `&#8211;` entity):
 *  a lone hyphen or en/em dash means "no town". Pure. */
export function cartCity(raw: string | undefined): string {
  const city = decodeEntities(raw ?? '').trim();
  return /^[-–—]$/.test(city) ? '' : city;
}
