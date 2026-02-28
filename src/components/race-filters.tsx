"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pcp_race_filters";
function saveFilters(d: string, gender: string, country: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d, gender, country })); } catch {}
}
function loadFilters() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

interface Country { code: string; name: string; }

export function RaceFilters({ countries, basePath = "/races" }: { countries: Country[]; basePath?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [discipline, setDiscipline] = useState(sp.get("d") || "all");
  const [gender, setGender] = useState(sp.get("gender") || "all");
  const [country, setCountry] = useState(sp.get("country") || "");
  const [cat, setCat] = useState(sp.get("cat") || "all");
  const [filterOpen, setFilterOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sp.get("d") || sp.get("gender") || sp.get("country")) return;
    const saved = loadFilters();
    if (!saved) return;
    const d = saved.d || "all"; const g = saved.gender || "all"; const c = saved.country || "";
    setDiscipline(d); setGender(g); setCountry(c);
    if (d !== "all" || g !== "all" || c) router.replace(`${basePath}?${buildParams(d, g, c).toString()}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [filterOpen]);

  function buildParams(d: string, g: string, c: string) {
    const params = new URLSearchParams();
    if (d && d !== "all") params.set("d", d);
    if (g && g !== "all") params.set("gender", g);
    if (c) params.set("country", c);
    if (cat && cat !== "all") params.set("cat", cat);
    const tab = sp.get("tab"); if (tab) params.set("tab", tab);
    return params;
  }

  function apply(d: string, g: string, c: string) {
    saveFilters(d, g, c);
    router.push(`${basePath}?${buildParams(d, g, c).toString()}`);
  }

  const hasSecondary = gender !== "all" || !!country;

  const disciplines = [
    { value: "all", label: "Both" },
    { value: "road", label: "Road" },
    { value: "mtb", label: "MTB" },
  ];

  const genders = [
    { value: "all", label: "All" },
    { value: "men", label: "Men" },
    { value: "women", label: "Women" },
  ];

  return (
    <div className="flex items-center gap-3 w-full">
      {/* ── Primary: discipline tabs ────────────────── */}
      <div className="flex items-center gap-0 border border-border/40 rounded-md overflow-hidden shrink-0">
        {disciplines.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setDiscipline(value); apply(value, gender, country); }}
            className={cn(
              "px-2.5 h-6 text-[11px] font-semibold transition-colors border-r border-border/40 last:border-r-0",
              discipline === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Secondary: gender — hidden on mobile, inline on md+ ── */}
      <div className="hidden md:flex items-center gap-1 shrink-0">
        {genders.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setGender(value); apply(discipline, value, country); }}
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded transition-colors",
              gender === value
                ? "text-foreground bg-white/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Country — hidden on mobile ── */}
      <div className="hidden md:block relative shrink-0">
        <select
          value={country}
          onChange={(e) => { setCountry(e.target.value); apply(discipline, gender, e.target.value); }}
          className={cn(
            "appearance-none bg-transparent pr-4 h-7 text-xs font-medium transition-colors cursor-pointer focus:outline-none",
            country ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <option value="">Country</option>
          {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground text-[9px]">▾</span>
      </div>

      {/* ── Mobile: Filters button with dropdown ── */}
      <div className="relative md:hidden" ref={dropdownRef}>
        <button
          onClick={() => setFilterOpen(o => !o)}
          className={cn(
            "flex items-center gap-1.5 h-6 px-2 rounded border text-[11px] font-medium transition-colors",
            (hasSecondary || filterOpen)
              ? "border-primary/60 text-primary bg-primary/10"
              : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70"
          )}
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 3.5A.5.5 0 0 1 2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5zm2 4A.5.5 0 0 1 4 7h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5zm3 4a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5z"/>
          </svg>
          Filters
          {hasSecondary && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>

        {filterOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border/50 bg-zinc-900 shadow-2xl p-3 z-[200] space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Gender</p>
              <div className="flex gap-1">
                {genders.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => { setGender(value); apply(discipline, value, country); setFilterOpen(false); }}
                    className={cn(
                      "flex-1 h-7 text-xs font-medium rounded transition-colors",
                      gender === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/5 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Country</p>
              <select
                value={country}
                onChange={(e) => { setCountry(e.target.value); apply(discipline, gender, e.target.value); setFilterOpen(false); }}
                className="w-full bg-white/5 rounded px-2 h-7 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
              >
                <option value="">All countries</option>
                {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            {hasSecondary && (
              <button
                onClick={() => { setGender("all"); setCountry(""); apply(discipline, "all", ""); setFilterOpen(false); }}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Desktop clear ── */}
      {hasSecondary && (
        <button
          onClick={() => { setGender("all"); setCountry(""); apply(discipline, "all", ""); }}
          className="hidden md:block text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Clear
        </button>
      )}
    </div>
  );
}
