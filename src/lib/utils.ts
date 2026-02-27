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
