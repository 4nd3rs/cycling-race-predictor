"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pcp_race_filters";

interface SavedFilters { d: string; gender: string; country: string; }
function saveFilters(d: string, gender: string, country: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d, gender, country })); } catch {}
}
function loadFilters(): SavedFilters | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

interface Country { code: string; name: string; }

/**
 * Top discipline filter — now includes Men's Road and Women's Road as first-class options.
 * Tabs:   All | Men's | Women's | MTB
 *
 * "Men's"   → ?d=road&gender=men
 * "Women's" → ?d=road&gender=women
 * "MTB"     → ?d=mtb  (clears gender)
 * "All"     → clears d + gender
 *
 * Active state is derived from BOTH ?d and ?gender params.
 */
export function DisciplineFilter({ basePath = "/" }: { basePath?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const d = sp.get("d") || "all";
  const g = sp.get("gender") || "all";

  // Derive a single "active tab" from d+gender
  function getActiveTab(d: string, g: string): string {
    if (d === "road" && g === "men")   return "mens";
    if (d === "road" && g === "women") return "womens";
    if (d === "mtb")                   return "mtb";
    return "all";
  }

  const [active, setActive] = useState(getActiveTab(d, g));

  // Restore last saved filter on first load (when no params in URL)
  useEffect(() => {
    if (sp.get("d") || sp.get("gender")) return;
    const saved = loadFilters();
    if (!saved?.d || saved.d === "all") return;
    const tab = getActiveTab(saved.d, saved.gender || "all");
    if (tab === "all") return;
    setActive(tab);
    const params = buildParams(tab, sp.get("country") || "");
    router.replace(`${basePath}?${params}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function buildParams(tab: string, country: string): string {
    const params = new URLSearchParams(sp.toString());
    params.delete("d");
    params.delete("gender");
    if (tab === "mens")   { params.set("d", "road"); params.set("gender", "men"); }
    if (tab === "womens") { params.set("d", "road"); params.set("gender", "women"); }
    if (tab === "mtb")    { params.set("d", "mtb"); }
    if (country) params.set("country", country); else params.delete("country");
    return params.toString();
  }

  function pick(tab: string) {
    setActive(tab);
    const savedCountry = loadFilters()?.country || "";
    const dVal = tab === "mens" || tab === "womens" ? "road" : tab === "mtb" ? "mtb" : "all";
    const gVal = tab === "mens" ? "men" : tab === "womens" ? "women" : "all";
    saveFilters(dVal, gVal, savedCountry);
    router.push(`${basePath}?${buildParams(tab, savedCountry)}`);
  }

  const TABS = [
    { value: "all",    label: "All" },
    { value: "mens",   label: "Men's" },
    { value: "womens", label: "Women's" },
    { value: "mtb",    label: "MTB" },
  ] as const;

  return (
    <div className="flex items-center gap-0 border border-border/40 rounded-md overflow-hidden shrink-0">
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => pick(value)}
          className={cn(
            "px-3 h-6 text-[11px] font-semibold transition-colors border-r border-border/40 last:border-r-0",
            active === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Secondary calendar filters — country only when gender is already set by DisciplineFilter.
 * Shows gender toggle only when viewing "All" or "MTB" (where gender isn't set by top bar).
 */
export function CalendarFilters({ countries, basePath = "/" }: { countries: Country[]; basePath?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const topDiscipline = sp.get("d") || "all";
  const topGender = sp.get("gender") || "all";

  // If the top filter has already locked gender (Men's Road / Women's Road), don't show gender row
  const genderLockedByTopBar = topDiscipline === "road" && (topGender === "men" || topGender === "women");

  const [gender, setGender] = useState(genderLockedByTopBar ? topGender : topGender);
  const [country, setCountry] = useState(sp.get("country") || "");

  // Sync state when URL changes
  useEffect(() => {
    setGender(sp.get("gender") || "all");
    setCountry(sp.get("country") || "");
  }, [sp.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(g: string, c: string) {
    const saved = loadFilters() || { d: "all", gender: "all", country: "" };
    saveFilters(saved.d, g, c);
    const params = new URLSearchParams(sp.toString());
    if (g !== "all") params.set("gender", g); else params.delete("gender");
    if (c) params.set("country", c); else params.delete("country");
    router.push(`${basePath}?${params.toString()}`);
  }

  const hasFilter = (!genderLockedByTopBar && gender !== "all") || !!country;
  const pill = (active: boolean) => cn(
    "px-2.5 h-6 text-xs font-medium rounded transition-colors",
    active ? "text-foreground bg-white/10" : "text-muted-foreground hover:text-foreground"
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Gender row — only shown when top bar hasn't set gender */}
      {!genderLockedByTopBar && (
        <div className="flex items-center gap-0.5">
          {([["all", "All"], ["men", "Men"], ["women", "Women"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setGender(v); apply(v, country); }} className={pill(gender === v)}>
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Country */}
      <div className="relative">
        <select
          value={country}
          onChange={(e) => { setCountry(e.target.value); apply(gender, e.target.value); }}
          className={cn(
            "appearance-none bg-transparent pr-4 h-6 text-xs font-medium transition-colors cursor-pointer focus:outline-none",
            country ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <option value="">Country</option>
          {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground text-[9px]">▾</span>
      </div>

      {hasFilter && (
        <button
          onClick={() => { setGender("all"); setCountry(""); apply("all", ""); }}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** Legacy export */
export function RaceFilters({ countries, basePath = "/races" }: { countries: Country[]; basePath?: string }) {
  return <CalendarFilters countries={countries} basePath={basePath} />;
}
