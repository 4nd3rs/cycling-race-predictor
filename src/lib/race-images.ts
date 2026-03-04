/**
 * Curated hero images for major races.
 * All images are CC-licensed, downloaded to /public/races/ and served from our own domain.
 *
 * To add a new race:
 * 1. Find a CC-licensed photo on Wikimedia Commons (commons.wikimedia.org)
 * 2. Download + resize to 1280px wide: curl ... -o public/races/SLUG-src.jpg && sips -Z 1280 ...
 * 3. Add an entry below with slug, src (relative to /public), credit, license, and commons URL.
 */

export interface RaceImageMeta {
  /** Path relative to the Next.js /public directory, e.g. "/races/strade-bianche.jpg" */
  src: string;
  /** Photographer or uploader name (plain text) */
  credit: string;
  /** SPDX-style license shorthand, e.g. "CC BY 2.0" */
  license: string;
  /** Wikimedia Commons page URL for the image (for attribution link) */
  commonsUrl: string;
}

/** Map from race_event.slug → image metadata */
const RACE_IMAGES: Record<string, RaceImageMeta> = {
  "strade-bianche": {
    src: "/races/strade-bianche.jpg",
    credit: "Adrian Betteridge",
    license: "CC BY 2.0",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Strade_Bianche_(51964933290).jpg",
  },
  "paris-nice": {
    src: "/races/paris-nice.jpg",
    credit: "Martino Photos",
    license: "CC BY-SA 2.0",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Mads_Pedersen,_2023_Paris-Nice_(52917273166).jpg",
  },
  "kuurne-brussel-kuurne": {
    src: "/races/kuurne-brussel-kuurne.jpg",
    credit: "filip bossuyt",
    license: "CC BY 2.0",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Mathieu_van_der_Poel_KBK_2021.jpg",
  },
};

/**
 * Look up the hero image for a race by its slug.
 * Strips year suffix from slugs (e.g. "strade-bianche-2026" → "strade-bianche").
 */
export function getRaceImage(slug: string | null | undefined): RaceImageMeta | null {
  if (!slug) return null;
  // Try exact match first
  if (RACE_IMAGES[slug]) return RACE_IMAGES[slug];
  // Strip trailing year (e.g. "-2026", "-2025")
  const base = slug.replace(/-\d{4}$/, "");
  return RACE_IMAGES[base] ?? null;
}
