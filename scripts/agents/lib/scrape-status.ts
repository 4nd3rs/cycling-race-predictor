/**
 * scrape-status.ts — Shared scrape status tracker
 *
 * All pipeline agents call writeScrapeStatus() after each run.
 * Maintains SCRAPE_STATUS.md at the project root — human-readable +
 * machine-parseable (JSON blob embedded in an HTML comment).
 */

import * as fs from "fs";
import * as path from "path";

const STATUS_FILE = path.resolve(__dirname, "../../../SCRAPE_STATUS.md");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScrapeComponent = "calendar" | "startlists" | "results";
export type ScrapeStatus = "ok" | "warn" | "error" | "skipped";

export interface RaceRow {
  name: string;
  date: string;
  count: number;       // riders / results
  status: string;      // "✅ full" | "⚠️ partial" | "❌ failed" | "⏭️ no pcsUrl" | "⏳ pending"
  scrapedAt: string;
}

export interface ScrapeRun {
  component: ScrapeComponent;
  status: ScrapeStatus;
  summary: string;
  raceRows?: RaceRow[];
}

interface StoredRun extends ScrapeRun {
  updatedAt: string;
}

// ─── Read/write helpers ───────────────────────────────────────────────────────

function nowStockholm(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).replace("T", " ");
}

function loadExisting(): Record<string, StoredRun> {
  try {
    if (!fs.existsSync(STATUS_FILE)) return {};
    const content = fs.readFileSync(STATUS_FILE, "utf-8");
    const match = content.match(/<!-- STATUS_JSON\n([\s\S]+?)\nSTATUS_JSON -->/);
    if (match) return JSON.parse(match[1]);
  } catch {
    // ignore parse errors — start fresh
  }
  return {};
}

function badge(s: ScrapeStatus): string {
  return s === "ok" ? "✅ OK" : s === "warn" ? "⚠️ WARN" : s === "error" ? "❌ ERROR" : "⏭️ SKIPPED";
}

function renderSection(title: string, run: StoredRun, resultLabel: string): string[] {
  const lines = [
    `## ${title}`,
    `- **Last run:** ${run.updatedAt}`,
    `- **Status:** ${badge(run.status)}`,
    `- ${run.summary}`,
  ];
  if (run.raceRows && run.raceRows.length > 0) {
    lines.push("");
    lines.push(`| Race | Date | ${resultLabel} | Status | Scraped |`);
    lines.push("|------|------|---------|--------|---------|");
    for (const row of run.raceRows) {
      lines.push(`| ${row.name} | ${row.date} | ${row.count} | ${row.status} | ${row.scrapedAt} |`);
    }
  }
  lines.push("");
  return lines;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function writeScrapeStatus(run: ScrapeRun): void {
  const state = loadExisting();
  const now = nowStockholm();
  state[run.component] = { ...run, updatedAt: now };

  const lines: string[] = [
    "# SCRAPE_STATUS.md — Pipeline Status",
    "",
    `_Last updated: ${now} (Stockholm)_`,
    "",
  ];

  const cal = state["calendar"];
  if (cal) lines.push(...renderSection("📅 Race Calendar", cal, "Races"));

  const sl = state["startlists"];
  if (sl) lines.push(...renderSection("📋 Startlists", sl, "Riders"));

  const res = state["results"];
  if (res) lines.push(...renderSection("🏁 Results", res, "Results"));

  lines.push("---");
  lines.push("<!-- STATUS_JSON");
  lines.push(JSON.stringify(state, null, 2));
  lines.push("STATUS_JSON -->");

  fs.writeFileSync(STATUS_FILE, lines.join("\n"), "utf-8");
}

export function readScrapeStatus(): Record<string, StoredRun> {
  return loadExisting();
}
