import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely extract a YYYY-MM-DD string from a date field that may come back
 * from Neon as a JS Date object (serialized to ISO timestamp) or already as
 * a plain date string. Always returns the UTC date portion.
 */
export function toDateStr(d: string | Date | null | undefined): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return String(d);
  return String(d).split("T")[0];
}

/**
 * Parse a race date (string or Neon Date object) into a JS Date at UTC noon,
 * safe for day-level comparisons like differenceInDays / isToday / isPast.
 */
export function toRaceDate(d: string | Date | null | undefined): Date {
  return new Date(toDateStr(d) + "T12:00:00Z");
}

/**
 * Return today's date as YYYY-MM-DD in Europe/Stockholm timezone.
 * Use this instead of new Date().toISOString().split("T")[0] to avoid
 * off-by-one errors caused by races stored as midnight CET (= 23:00 UTC).
 */
export function todayStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

/**
 * Calendar-day distance from today (Stockholm) to a race date string.
 * Unlike date-fns differenceInDays, this counts calendar days, not 24h periods.
 * Paris-Nice on March 8 at 21:00 UTC will return 1 ("TOMORROW"), not 0 ("TODAY").
 */
export function calendarDaysUntil(raceDateStr: string | Date | null | undefined): number {
  const raceStr = toDateStr(raceDateStr);
  if (!raceStr) return Infinity;
  const today = todayStr();
  const [ty, tm, td] = today.split("-").map(Number);
  const [ry, rm, rd] = raceStr.split("-").map(Number);
  const todayUTC = Date.UTC(ty, tm - 1, td);
  const raceUTC = Date.UTC(ry, rm - 1, rd);
  return Math.round((raceUTC - todayUTC) / 86_400_000);
}
