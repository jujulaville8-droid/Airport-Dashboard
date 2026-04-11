/**
 * Shared date helpers used across Counterpoint parsers, API routes, and
 * analytics code. Previously these were duplicated in 4+ places (audit M6, L3).
 *
 * All functions are timezone-safe: they operate on YYYY-MM-DD strings with
 * UTC-based math, matching the convention adopted in /api/sales/daily after
 * the session-2 audit.
 */

export const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4,
  May: 5, June: 6, July: 7, August: 8,
  September: 9, October: 10, November: 11, December: 12,
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Add N days to a YYYY-MM-DD string, returning YYYY-MM-DD. TZ-safe via UTC.
 */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().substring(0, 10);
}

/**
 * Today as YYYY-MM-DD in UTC.
 */
export function todayYmd(): string {
  return new Date().toISOString().substring(0, 10);
}

/**
 * Given a YYYY-MM string, return the last day of that month as a 2-digit string.
 */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return String(lastDay).padStart(2, '0');
}

/**
 * Format a time-of-day as 12-hour with am/pm suffix.
 *
 * Accepts a handful of shapes so callers don't have to normalize:
 * - "HH:MM"       → "h:mmam" / "h:mmpm"
 * - "HH:MM:SS"    → same
 * - ISO timestamp → same, using the time portion only (TZ-naive to match DB)
 *
 * Empty / invalid input returns "--". Minutes are omitted when zero for
 * tighter display (e.g. "2pm" instead of "2:00pm"). Use formatTime12WithMinutes
 * when you always want minutes shown.
 */
export function formatTime12(input: string | null | undefined): string {
  if (!input) return '--';
  // Pull HH:MM off the front, or out of an ISO timestamp (T-separated).
  const match = input.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '--';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return '--';
  }
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}
