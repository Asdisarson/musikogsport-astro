import { describe, expect, it } from 'vitest';
import { hoursLines, hoursStatus, parseHours, weekSummary, type Week } from './openingHours';

// The /opnunartimi/ WordPress page's text (2026-10-30).
const LIVE = ['Virkir dagar frá kl 10:00 - 18:00', 'Laugardagar frá kl 10:00 - 16:00'];
const weekday = { open: '10:00', close: '18:00' };
const saturday = { open: '10:00', close: '16:00' };
const week: Week = [weekday, weekday, weekday, weekday, weekday, saturday, null];
// Iceland keeps UTC all year: 2026-10-26 is a Monday.
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 26 + day, h, m));
};

describe('hoursLines', () => {
  it('reads the text lines of the page’s html blocks', () => {
    const html = '<h4 class="has-text-align-center">Virkir dagar frá kl 10:00 - 18:00<br />\nLaugardagar frá kl 10:00 - 16:00</h4>';
    expect(hoursLines([{ fullWidth: false, cols: [{ span: 6, blocks: [{ type: 'html', html }] }] }])).toEqual(LIVE);
  });
  it('decodes entities and drops empty lines', () => {
    const html = '<p>Sunnudagar&nbsp;lokað</p><p> </p>';
    expect(hoursLines([{ fullWidth: false, cols: [{ span: 12, blocks: [{ type: 'html', html }, { type: 'wishlist' }] }] }])).toEqual(['Sunnudagar lokað']);
  });
});

describe('parseHours', () => {
  it('reads the live page into a week, Monday first; a day not named is closed', () => {
    expect(parseHours(LIVE)).toEqual(week);
  });
  it('reads other ways of writing it', () => {
    expect(parseHours(['Mánudaga - föstudaga: 10-18', 'Laugardaga 11.00–15.00', 'Sunnudaga: lokað'])).toEqual([
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      { open: '11:00', close: '15:00' },
      null,
    ]);
    expect(parseHours(['Alla daga kl. 9 - 21'])).toEqual(Array(7).fill({ open: '09:00', close: '21:00' }));
  });
  it('gives up (null) on any line it can’t read, or on nothing at all', () => {
    expect(parseHours([...LIVE, 'Lokað um jólin'])).toBeNull();
    expect(parseHours([])).toBeNull();
    expect(parseHours(['Virkir dagar frá kl 25:00 - 18:00'])).toBeNull();
  });
  it('gives up on a day range that wraps past Sunday rather than reading it backwards', () => {
    expect(parseHours(['Föstudagur - mánudagur kl. 12 - 18'])).toBeNull();
  });
});

describe('weekSummary', () => {
  it('groups days in a row with the same hours', () => {
    expect(weekSummary(week)).toEqual([
      { days: 'Virka daga', hours: '10:00 – 18:00' },
      { days: 'Laugardagur', hours: '10:00 – 16:00' },
      { days: 'Sunnudagur', hours: 'Lokað' },
    ]);
  });
  it('names Monday–Friday "Virka daga", a two-day group with "og", other runs with a dash, the whole week "Alla daga"', () => {
    expect(weekSummary([weekday, weekday, weekday, saturday, saturday, saturday, null])[0]).toEqual({ days: 'Mánudagur – miðvikudagur', hours: '10:00 – 18:00' });
    expect(weekSummary([weekday, weekday, weekday, weekday, weekday, null, null])).toEqual([
      { days: 'Virka daga', hours: '10:00 – 18:00' },
      { days: 'Laugardagur og sunnudagur', hours: 'Lokað' },
    ]);
    expect(weekSummary(Array(7).fill(weekday))).toEqual([{ days: 'Alla daga', hours: '10:00 – 18:00' }]);
  });
});

describe('hoursStatus', () => {
  it('is open within the day’s hours, and says when it closes', () => {
    expect(hoursStatus(week, at(0, '10:00'))).toEqual({ open: true, today: 0, text: 'Opið núna · lokar kl. 18:00' });
    expect(hoursStatus(week, at(5, '15:59'))).toEqual({ open: true, today: 5, text: 'Opið núna · lokar kl. 16:00' });
  });
  it('says when it opens next: later today, tomorrow, or on a named day', () => {
    expect(hoursStatus(week, at(1, '08:30')).text).toBe('Lokað · opnar kl. 10:00');
    expect(hoursStatus(week, at(1, '18:00')).text).toBe('Lokað · opnar á morgun kl. 10:00');
    expect(hoursStatus(week, at(5, '17:00')).text).toBe('Lokað · opnar á mánudag kl. 10:00');
    expect(hoursStatus(week, at(6, '12:00'))).toEqual({ open: false, today: 6, text: 'Lokað · opnar á morgun kl. 10:00' });
  });
  it('is just closed when no day opens', () => {
    expect(hoursStatus(Array(7).fill(null), at(0, '12:00')).text).toBe('Lokað');
  });
});
