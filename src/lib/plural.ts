// Icelandic number agreement. Pure, client-safe (no imports): the cart badge island uses it too.

/** Icelandic takes the singular after a number ending in 1, except one ending in 11 ("21 vara", "11 vörur"). */
export function isSingular(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

/** "1 vara" / "125 vörur": the number with the form that agrees with it. */
export function countWord(n: number, singular: string, plural: string): string {
  return `${n} ${isSingular(n) ? singular : plural}`;
}
