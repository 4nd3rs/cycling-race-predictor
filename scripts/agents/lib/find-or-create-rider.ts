/**
 * findOrCreateRider — the single source of truth for rider lookup/creation.
 *
 * ALWAYS use this instead of raw DB inserts when dealing with rider names from
 * external sources (PCS, UCI, startlist PDFs, gossip, etc.).
 *
 * Normalizes names before lookup to prevent duplicates:
 *   "GIRMAY Biniam", "Biniam Girmay", "GIRMAY  Biniam" → all find the same record
 *
 * Name format rules:
 * - External names are normalized to "Firstname Lastname" title-case
 * - Accents stripped for matching, preserved in stored name
 * - Apostrophes/hyphens stripped for matching only
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../../../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ─── Normalisation ──────────────────────────────────────────────────────────

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalize for matching: lowercase, strip accents + special chars */
export function normalizeName(name: string): string {
  return stripAccents(name)
    .replace(/[^a-zA-Z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Convert UCI/PCS all-caps name format to display format.
 * "VAN DER POEL Mathieu" → "Mathieu Van Der Poel"
 * "GIRMAY Biniam"        → "Biniam Girmay"
 */
export function toDisplayName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  const upper: string[] = [], first: string[] = [];
  for (const p of parts) {
    // All-caps token = surname part
    if (/^[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇÆŒÑ\-']+$/.test(p)) upper.push(p);
    else first.push(p);
  }
  if (!first.length) first.push(upper.pop()!);
  // Title-case the surname parts
  const surname = upper.map(w => w[0] + w.slice(1).toLowerCase()).join(" ");
  return [...first, surname].join(" ");
}

// ─── Rider cache (per-process, reduces DB round-trips) ──────────────────────

const riderCache = new Map<string, string>(); // normalizedName → rider.id

export function clearRiderCache() {
  riderCache.clear();
}

// ─── Core function ──────────────────────────────────────────────────────────

export interface FindOrCreateOptions {
  /** Raw name from external source (any format) */
  name: string;
  /** ISO 3-letter nationality code (optional, used when creating) */
  nationality?: string | null;
  /** PCS rider ID (optional) */
  pcsId?: string | null;
  /** UCI ID (optional) */
  uciId?: string | null;
  /**
   * If true, don't create — just return null if not found.
   * Useful for lookups where you don't want to pollute the DB.
   */
  lookupOnly?: boolean;
  /** Override the display name stored in DB (if you know the canonical form) */
  displayName?: string;
}

export async function findOrCreateRider(opts: FindOrCreateOptions): Promise<string | null> {
  const { name, nationality, pcsId, uciId, lookupOnly = false, displayName } = opts;

  const normKey = normalizeName(name);
  if (!normKey) return null;

  // Cache hit
  if (riderCache.has(normKey)) return riderCache.get(normKey)!;

  // ── 1. Try exact name match ──
  let existing = await db.query.riders.findFirst({
    where: (r, { ilike }) => ilike(r.name, name.trim()),
    columns: { id: true },
  });

  // ── 2. Try normalized match (load and compare in JS for flexibility) ──
  if (!existing) {
    // Load candidates by last word (rough index hit)
    const parts = normKey.split(" ");
    const lastName = parts[parts.length - 1];
    // Search with ilike on last name fragment
    const candidates = await db.query.riders.findMany({
      where: (r, { ilike }) => ilike(r.name, `%${lastName}%`),
      columns: { id: true, name: true },
    });
    const match = candidates.find(c => normalizeName(c.name) === normKey);
    if (match) existing = match;
  }

  // ── 3. Try pcsId match ──
  if (!existing && pcsId) {
    existing = await db.query.riders.findFirst({
      where: (r, { eq }) => eq(r.pcsId, pcsId),
      columns: { id: true },
    }) ?? null;
  }

  if (existing) {
    // Update with any new data we have
    if (pcsId || uciId || nationality) {
      await db.update(schema.riders)
        .set({
          ...(pcsId ? { pcsId } : {}),
          ...(uciId ? { uciId } : {}),
          ...(nationality && !existing ? { nationality } : {}),
          updatedAt: new Date(),
        })
        .where((schema.riders.id as any).equals?.(existing.id) ?? require("drizzle-orm").eq(schema.riders.id, existing.id));
    }
    riderCache.set(normKey, existing.id);
    return existing.id;
  }

  if (lookupOnly) return null;

  // ── 4. Create new rider ──
  // Determine the display name to store
  const storedName = displayName ?? toDisplayName(name);

  const [newRider] = await db.insert(schema.riders)
    .values({
      name: storedName,
      nationality: nationality ?? null,
      pcsId: pcsId ?? null,
      uciId: uciId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.riders.id });

  if (!newRider) {
    // Race condition — try to find again
    const retry = await db.query.riders.findFirst({
      where: (r, { ilike }) => ilike(r.name, storedName),
      columns: { id: true },
    });
    if (retry) {
      riderCache.set(normKey, retry.id);
      return retry.id;
    }
    return null;
  }

  riderCache.set(normKey, newRider.id);
  return newRider.id;
}
