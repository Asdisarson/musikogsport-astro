// The footer bar's company line is one wp-admin sentence ("Músík og Sport ehf. Dalshraun 10, 220 Hafnarfjörður,
// kennitala 710303-2310 Allur réttur áskilinn 2025 ©"). The bar shows its two facts on their own — the address is
// already in the footer's contact column, and the copyright year follows the calendar — or the sentence as written
// when it doesn't read that way.

/** The company's name (up to and including its form: ehf., hf., slf. …) and kennitala as "DDMMYY-NNNN", or null. */
export function companyParts(line: string): { name: string; kennitala: string } | null {
  const name = /^\s*(.+?\b(?:ehf|hf|slf|sf|ses|ohf)\.)/i.exec(line)?.[1];
  const kt = /\b(?:kennitala|kt\.?)\s*(\d{6})-?(\d{4})\b/i.exec(line);
  return name && kt ? { name, kennitala: `${kt[1]}-${kt[2]}` } : null;
}
