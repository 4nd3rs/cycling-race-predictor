/**
 * /api/cron/sync-road-uci
 * Syncs road UCI individual ranking points from ProCyclingStats.
 * Runs every Tuesday (PCS updates rankings weekly).
 */

import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { db, riderDisciplineStats } from "@/lib/db";
import { riders } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { scrapeDo } from "@/lib/scraper/scrape-do";
import * as cheerio from "cheerio";
import { postToDiscord } from "@/lib/discord";
import { stripAccents as _stripAccents } from "@/lib/normalize-name";

export const maxDuration = 300;

const LIMIT = 300;

function stripAccents(s: string) {
  return _stripAccents(s).toLowerCase().trim();
}

interface Entry { rank: number; name: string; uciPoints: number }

async function scrapePCS(baseUrl: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  let page = 1;

  while (entries.length < LIMIT) {
    const url = page === 1 ? baseUrl : `${baseUrl}/p/${page}`;
    try {
      const html = await scrapeDo(url, { timeout: 60000 });
      const $ = cheerio.load(html);
      let rowsOnPage = 0;

      $("table tbody tr").each((_, row) => {
        const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
        if (cells.length < 4) return;
        const rank = parseInt(cells[0]);
        if (!rank) return;

        const rawName = cells[3];
        if (!rawName || rawName.length < 3) return;
        // PCS format: "VAN DER POEL Mathieu" — last token = first name, rest = surname
        const parts = rawName.split(" ");
        const firstName = parts[parts.length - 1];
        const lastName = parts.slice(0, -1).map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
        const name = `${firstName} ${lastName}`.trim();

        const uciPoints = parseInt((cells[cells.length - 1].match(/[\d,]+/) ?? ["0"])[0].replace(/,/g, "")) || 0;
        entries.push({ rank, name, uciPoints });
        rowsOnPage++;
      });

      if (rowsOnPage < 10) break;
      page++;
      await new Promise(r => setTimeout(r, 600));
    } catch {
      break;
    }
  }

  return entries.slice(0, LIMIT);
}

async function syncRankings(entries: Entry[], gender: string): Promise<{ updated: number; notFound: number }> {
  const allRiders = await db.select({ id: riders.id, name: riders.name }).from(riders).limit(30000);

  const byName = new Map<string, string>();
  for (const r of allRiders) {
    const stripped = stripAccents(r.name);
    byName.set(stripped, r.id);
    // Also index reversed: "First Last" ↔ "Last First"
    const parts = stripped.split(" ");
    if (parts.length >= 2) {
      const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
      if (!byName.has(reversed)) byName.set(reversed, r.id);
    }
  }

  let updated = 0, notFound = 0;

  for (const entry of entries) {
    const riderId = byName.get(stripAccents(entry.name));
    if (!riderId) { notFound++; continue; }

    const existing = await db.query.riderDisciplineStats.findFirst({
      where: and(
        eq(riderDisciplineStats.riderId, riderId),
        eq(riderDisciplineStats.discipline, "road"),
        eq(riderDisciplineStats.ageCategory, "elite"),
      ),
    });

    const eloBoost = Math.round((entry.uciPoints / 4000) * 350);
    const newElo = String((1500 + eloBoost).toFixed(4));

    if (existing) {
      const updates: Record<string, unknown> = { uciPoints: entry.uciPoints, uciRank: entry.rank, gender, updatedAt: new Date() };
      if ((existing.racesTotal ?? 0) === 0) { updates.eloMean = newElo; updates.currentElo = String((1500 + eloBoost).toFixed(2)); }
      await db.update(riderDisciplineStats).set(updates).where(eq(riderDisciplineStats.id, existing.id));
    } else {
      await db.insert(riderDisciplineStats).values({
        riderId, discipline: "road", ageCategory: "elite", gender,
        uciPoints: entry.uciPoints, uciRank: entry.rank,
        currentElo: String((1500 + eloBoost).toFixed(2)),
        eloMean: newElo, eloVariance: "350",
      }).onConflictDoNothing();
    }
    updated++;
  }

  return { updated, notFound };
}

export async function GET() {
  if (!(await verifyCronAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const men = await scrapePCS("https://www.procyclingstats.com/rankings/me/uci-individual");
    const { updated: menUp, notFound: menMiss } = await syncRankings(men, "men");

    await new Promise(r => setTimeout(r, 3000));

    const women = await scrapePCS("https://www.procyclingstats.com/rankings/we/world-ranking");
    const { updated: womenUp, notFound: womenMiss } = await syncRankings(women, "women");

    const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
    await postToDiscord(
      `📊 Road UCI Rankings [${time}]\n• Men: ${menUp} updated, ${menMiss} not found\n• Women: ${womenUp} updated, ${womenMiss} not found`
    );

    return NextResponse.json({ success: true, men: { updated: menUp, notFound: menMiss }, women: { updated: womenUp, notFound: womenMiss }, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/sync-road-uci]", error);
    await postToDiscord(`📊 Road UCI Rankings ⚠️ Error: ${String(error).substring(0, 200)}`);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST() { return GET(); }
