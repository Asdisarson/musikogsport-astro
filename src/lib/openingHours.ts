// The /opnunartimi/ page's hours, read from its WordPress text ("Virkir dagar frá kl 10:00 - 18:00") so the owner keeps
// editing them in wp-admin, and whether the shop is open at a given moment. Pure, no DOM: the page renders the week
// on the server and its script works out "Opið núna" in the browser (Iceland keeps UTC all year, so UTC is local).
import { decodeEntities } from './decode';
import type { Row } from './wpbakery';

/** One day's hours as "HH:MM", or null when closed. */
export type Day = { open: string; close: string } | null;
/** Monday first. */
export type Week = Day[];

export const DAY_NAMES = ['Mánudagur', 'Þriðjudagur', 'Miðvikudagur', 'Fimmtudagur', 'Föstudagur', 'Laugardagur', 'Sunnudagur'];
/** After "opnar á …". */
const DAY_ACCUSATIVE = ['mánudag', 'þriðjudag', 'miðvikudag', 'fimmtudag', 'föstudag', 'laugardag', 'sunnudag'];

/** The text lines of a page's html blocks: <br> and block ends break lines, tags go, entities are decoded. */
export function hoursLines(rows: Row[]): string[] {
  const html = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks.flatMap((b) => (b.type === 'html' ? [b.html] : [])))).join('\n');
  return decodeEntities(html.replace(/<br\s*\/?>|<\/(p|h[1-6]|li|div)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Which days a line's label names (lower-case, Icelandic), Monday = 0.
const DAY_STEMS = ['mánud', 'þriðjud', 'miðvikud', 'fimmtud', 'föstud', 'laugard', 'sunnud'];
function daysOf(label: string): number[] | null {
  const l = label.toLowerCase();
  if (/alla daga/.test(l)) return [0, 1, 2, 3, 4, 5, 6];
  if (/virk/.test(l)) return [0, 1, 2, 3, 4];
  const named = DAY_STEMS.flatMap((stem, i) => (l.includes(stem) ? [i] : []));
  if (named.length === 2 && /[-–]|til/.test(l)) {
    // A range runs in the order it's written; one that wraps past Sunday (föstudagur – mánudagur) isn't read.
    const [from, to] = named;
    if (l.indexOf(DAY_STEMS[from]) > l.indexOf(DAY_STEMS[to])) return null;
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
  }
  return named.length ? named : null;
}

function clock(h: string, m: string | undefined): string | null {
  const hh = Number(h);
  const mm = Number(m ?? '0');
  if (!(hh <= 24 && mm < 60)) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const HOURS = /^(.+?)[\s:]+(?:frá\s+)?(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\.?$/i;
const CLOSED = /^(.+?)[\s:]+lokað\.?$/i;

/** The week the lines describe, or null when any line can't be read (the page then shows the owner's text as written,
 *  never a wrong table). A day no line names is closed. */
export function parseHours(lines: string[]): Week | null {
  if (!lines.length) return null;
  const week: Week = Array(7).fill(null);
  for (const line of lines) {
    const hours = HOURS.exec(line);
    const closed = hours ? null : CLOSED.exec(line);
    const days = daysOf((hours ?? closed)?.[1] ?? '');
    if (!days) return null;
    if (hours) {
      const open = clock(hours[2], hours[3]);
      const close = clock(hours[4], hours[5]);
      if (!open || !close || open >= close) return null;
      for (const d of days) week[d] = { open, close };
    } else {
      for (const d of days) week[d] = null;
    }
  }
  return week;
}

/** The week in a few lines for a card: days in a row with the same hours together ("Virka daga", "Laugardagur og
 *  sunnudagur", "Mánudagur – miðvikudagur"). */
export function weekSummary(week: Week): { days: string; hours: string }[] {
  const hoursText = (d: Day) => (d ? `${d.open} – ${d.close}` : 'Lokað');
  const groups: { from: number; to: number; hours: string }[] = [];
  week.forEach((d, i) => {
    const last = groups[groups.length - 1];
    if (last && last.hours === hoursText(d)) last.to = i;
    else groups.push({ from: i, to: i, hours: hoursText(d) });
  });
  if (groups.length === 1 && week.length === 7) return [{ days: 'Alla daga', hours: groups[0].hours }];
  const lower = (i: number) => DAY_NAMES[i].toLowerCase();
  const daysText = (from: number, to: number) => {
    if (from === 0 && to === 4) return 'Virka daga';
    if (from === to) return DAY_NAMES[from];
    if (to === from + 1) return `${DAY_NAMES[from]} og ${lower(to)}`;
    return `${DAY_NAMES[from]} – ${lower(to)}`;
  };
  return groups.map(({ from, to, hours }) => ({ days: daysText(from, to), hours }));
}

/** Whether the shop is open at `now`, which weekday that is (Monday = 0), and a line saying so. */
export function hoursStatus(week: Week, now: Date): { open: boolean; today: number; text: string } {
  const today = (now.getUTCDay() + 6) % 7;
  const time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const day = week[today];
  if (day && time >= day.open && time < day.close) return { open: true, today, text: `Opið núna · lokar kl. ${day.close}` };
  if (day && time < day.open) return { open: false, today, text: `Lokað · opnar kl. ${day.open}` };
  for (let k = 1; k <= 7; k++) {
    const d = (today + k) % 7;
    const next = week[d];
    if (next) return { open: false, today, text: `Lokað · opnar ${k === 1 ? 'á morgun' : `á ${DAY_ACCUSATIVE[d]}`} kl. ${next.open}` };
  }
  return { open: false, today, text: 'Lokað' };
}
