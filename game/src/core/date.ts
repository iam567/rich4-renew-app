/**
 * Game dates, packed like the original: year << 16 | month << 8 | day (docs/rules/01 §4.1).
 * Per the bug decisions (docs/rules/README #10-#12) the remake uses the real Gregorian calendar,
 * a selectable start date, and month arithmetic that clamps to the end of the month.
 */
export type PackedDate = number;

export const pack = (year: number, month: number, day: number): PackedDate => (year << 16) | (month << 8) | day;
export const year = (d: PackedDate) => d >>> 16;
export const month = (d: PackedDate) => (d >>> 8) & 0xff;
export const day = (d: PackedDate) => d & 0xff;

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1]);

/** Next day; also reports whether a new month began (the original runs month-start settlement then). */
export function nextDay(d: PackedDate): { date: PackedDate; newMonth: boolean } {
  let y = year(d), m = month(d), dd = day(d) + 1;
  if (dd <= daysInMonth(y, m)) return { date: pack(y, m, dd), newMonth: false };
  dd = 1;
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return { date: pack(y, m, dd), newMonth: true };
}

/** Days since 1970-01-01 (UTC), for differences and weekdays. */
export function serial(d: PackedDate): number {
  return Math.round(Date.UTC(year(d), month(d) - 1, day(d)) / 86400000);
}

export function addDays(d: PackedDate, n: number): PackedDate {
  const t = new Date((serial(d) + n) * 86400000);
  return pack(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** d + months, clamped to the last day of the target month (fixes the original's 8/31 + 1 month = 9/31). */
export function addMonths(d: PackedDate, n: number): PackedDate {
  let y = year(d), m = month(d) + n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return pack(y, m, Math.min(day(d), daysInMonth(y, m)));
}

export const daysBetween = (from: PackedDate, to: PackedDate) => serial(to) - serial(from);

/** 0 = Sunday, like the original's weekday. */
export const weekday = (d: PackedDate) => ((serial(d) % 7) + 7 + 4) % 7;

export function today(): PackedDate {
  const t = new Date();
  return pack(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export const format = (d: PackedDate) => `${year(d)}/${month(d)}/${day(d)}`;
