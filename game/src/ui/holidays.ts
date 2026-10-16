/**
 * Holiday music (docs/rules/01 §4.4, 12-audio.md §1.3): the entries of the holiday table 0x47ff4a that carry
 * effect bit 4 (`fcn_00452444`). Only the music is remade here — the holiday pictures, rest days and gift cards
 * belong to the holiday system, which the remake does not have yet.
 *
 * | maps            | date                 | music            | days |
 * | 0 台灣, 1 大陸  | 12/25                | MIDI14-1 (13)    | 1    |
 * | 0 台灣, 1 大陸  | lunar 1/1            | MIDI14-2 (14)    | 3 (the next entry, lunar 1/2, has music too) |
 * | 2 日本, 3 美國  | 12/25                | MIDI14-1 (13)    | 1    |
 * Maps 4–7 have no holiday music; workshop maps (id ≥ 1000) have no holiday table.
 */
import { day, month, year, type PackedDate } from '../core/date';
import { Theme } from './audio';

/** Lunar month/day of a Gregorian date through Intl's Chinese calendar (the original reads its table 0x47639c). */
function lunar(d: PackedDate): [number, number] | null {
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    const parts = f.formatToParts(new Date(Date.UTC(year(d), month(d) - 1, day(d))));
    const m = parts.find(p => p.type === 'month')?.value ?? '', dd = parts.find(p => p.type === 'day')?.value ?? '';
    if (!/^\d+$/.test(m)) return null; // leap months ("4bis") never match
    return [Number(m), Number(dd)];
  } catch { return null; }
}

/** The holiday music of a day on a map: theme index and how many days it holds, or null. */
export function holidayMusic(d: PackedDate, mapId: number): { music: number; days: number } | null {
  if (mapId < 0 || mapId > 3) return null;
  if (month(d) === 12 && day(d) === 25) return { music: Theme.christmas, days: 1 };
  if (mapId <= 1) {
    const l = lunar(d);
    if (l && l[0] === 1 && l[1] === 1) return { music: Theme.newYear, days: 3 };
  }
  return null;
}
