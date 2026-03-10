const BASE_URL = "https://procyclingpredictor.com";

export function racePageUrl(
  discipline: string,
  eventSlug: string | null,
  categorySlug?: string | null
): string {
  if (!eventSlug) return BASE_URL;
  const base = `${BASE_URL}/races/${discipline}/${eventSlug}`;
  return categorySlug ? `${base}/${categorySlug}` : base;
}

export function riderPageUrl(riderId: string): string {
  return `${BASE_URL}/riders/${riderId}`;
}
