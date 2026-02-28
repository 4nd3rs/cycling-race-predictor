"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pcp_race_filters";
function saveFilters(d: string, gender: string, country: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d, gender, country })); } catch {}
}
function loadFilters() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

interface Country { code: string; name: string; }

/** Top bar — discipline only */
export function DisciplineFilter({ basePath = "/" }: { basePath?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [discipline, setDiscipline] = useState(sp.get("d") || "all");

  useEffect(() => {
    if (sp.get("d")) return;
    const saved = loadFilters();
    if (!saved?.d || saved.d === "all") return;
    setDiscipline(saved.d);
    const params = new URLSearchParams(sp.toString());
    params.set("d", saved.d);
    router.replace(`${basePath}?${params.toString()}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(value: string) {
    setDiscipline(value);
    const saved = loadFilters() || {};
    saveFilters(value, saved.gender || "all", saved.country || "");
    const params = new URLSearchParams(sp.toString());
    if (value === "all") params.delete("d"); else params.set("d", value);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-0 border border-border/40 rounded-md overflow-hidden shrink-0">
      {([["all","Both"],["road","Road"],["mtb","MTB"]] as const).map(([v, l]) => (
        <button
          key={v}
          onClick={() => pick(v)}
          className={cn(
            "px-3 h-6 text-[11px] font-semibold transition-colors border-r border-border/40 last:border-r-0",
            discipline === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Calendar section — gender + country */
export function CalendarFilters({ countries, basePath = "/" }: { countries: Country[]; basePath?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [gender, setGender] = useState(sp.get("gender") || "all");
  const [country, setCountry] = useState(sp.get("country") || "");

  useEffect(() => {
    if (sp.get("gender") || sp.get("country")) return;
    const saved = loadFilters();
    if (!saved) return;
    const g = saved.gender || "all"; const c = saved.country || "";
    setGender(g); setCountry(c);
    if (g !== "all" || c) {
      const params = new URLSearchParams(sp.toString());
      if (g !== "all") params.set("gender", g); else params.delete("gender");
      if (c) params.set("country", c); else params.delete("country");
      router.replace(`${basePath}?${params.toString()}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(g: string, c: string) {
    const saved = loadFilters() || {};
    saveFilters(saved.d || "all", g, c);
    const params = new URLSearchParams(sp.toString());
    if (g !== "all") params.set("gender", g); else params.delete("gender");
    if (c) params.set("country", c); else params.delete("country");
    router.push(`${basePath}?${params.toString()}`);
  }

  const hasFilter = gender !== "all" || !!country;
  const pill = (active: boolean) => cn(
    "px-2.5 h-6 text-xs font-medium rounded transition-colors",
    active ? "text-foreground bg-white/10" : "text-muted-foreground hover:text-foreground"
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-0.5">
        {([["all","All"],["men","Men"],["women","Women"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => { setGender(v); apply(v, country); }} className={pill(gender === v)}>{l}</button>
        ))}
      </div>

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

/** Legacy export for other pages that use the full filter */
export function RaceFilters({ countries, basePath = "/races" }: { countries: Country[]; basePath?: string }) {
  return <CalendarFilters countries={countries} basePath={basePath} />;
}
