/**
 * Time helpers. The browser sends its UTC offset (Date#getTimezoneOffset(), in minutes,
 * e.g. -330 for IST) so "today", "yesterday" and "this month" match the user's clock.
 */

export function parseTzOffset(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isDate(s: string) {
  return DATE_RE.test(s);
}
export function isMonth(s: string) {
  return MONTH_RE.test(s);
}

/** UTC instant of local midnight for a YYYY-MM-DD date. */
export function localDayStart(date: string, tzOffset: number): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error("invalid date");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + tzOffset * 60_000);
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

export function dayRange(date: string, tzOffset: number) {
  return { from: localDayStart(date, tzOffset), to: localDayStart(addDays(date, 1), tzOffset) };
}

export function monthRange(month: string, tzOffset: number) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error("invalid month");
  const y = +m[1];
  const mo = +m[2];
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  return { from: localDayStart(`${month}-01`, tzOffset), to: localDayStart(next, tzOffset) };
}

/** Shift a UTC instant into the user's wall clock (still a Date, read with getUTC*). */
function toLocal(d: Date, tzOffset: number) {
  return new Date(d.getTime() - tzOffset * 60_000);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "Monday 2026-10-27 14:05" in the user's local time. */
export function formatLocal(d: Date | string, tzOffset: number): string {
  const l = toLocal(new Date(d), tzOffset);
  const iso = l.toISOString();
  return `${WEEKDAYS[l.getUTCDay()]} ${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** e.g. "Mon, Oct 27" */
export function shortLocalDate(d: Date | string, tzOffset: number): string {
  const l = toLocal(new Date(d), tzOffset);
  return `${WEEKDAYS[l.getUTCDay()].slice(0, 3)}, ${MONTHS[l.getUTCMonth()]} ${l.getUTCDate()}`;
}

export function todayLocal(tzOffset: number): string {
  return toLocal(new Date(), tzOffset).toISOString().slice(0, 10);
}
