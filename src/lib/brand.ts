// Músík og Sport carries no structured "brand" field, but most product names
// lead with the brand (e.g. "ASICS GEL-NIMBUS 28"). Split it off conservatively
// using a known-brand list so the storefront can show BRAND / product cleanly,
// and never guesses when it isn't confident.

import { decodeEntities } from './decode';

// Longest-first so multi-word brands match before their first token.
const BRANDS = [
  'New Balance', 'Under Armour', 'Helly Hansen', 'The North Face', 'Castelli',
  'ASICS', 'Adidas', 'Nike', 'Puma', 'Reebok', 'Hoka', 'Salomon', 'Brooks',
  'Saucony', 'Mizuno', 'On', 'Icebug', 'Speedo', 'Arena', 'Didriksons', 'Craft',
  'Hummel', 'Errea', 'Erima', 'Select', 'Molten', 'Wilson', 'Babolat', 'Head',
  'Yonex', 'Garmin', 'Polar', 'Suunto', 'Jako', 'Kempa', 'Macron', 'Stanno',
  'Spalding', 'Joola', 'Stiga', 'CCM', 'Bauer', 'Sherwood', '2XU', 'Compressport',
  'Fischer', 'Atomic', 'Rossignol', 'Zone', 'Exel', 'Fila', 'Kappa', 'Mizuno',
].sort((a, b) => b.length - a.length);

export interface SplitName {
  brand?: string;
  rest: string;
}

/** Returns { brand, rest } if the name starts with a known brand, else { rest: name }. */
export function splitBrand(rawName: string): SplitName {
  const name = decodeEntities(rawName).trim();
  for (const brand of BRANDS) {
    const prefix = brand.toLowerCase() + ' ';
    if (name.toLowerCase().startsWith(prefix)) {
      const rest = name.slice(brand.length).trim();
      if (rest) return { brand: brand.toUpperCase(), rest };
    }
  }
  return { rest: name };
}
