"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pcp_race_filters";

function saveFilters(d: string, gender: string, country: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d, gender, country })); } catch {}
}
function loadFilters(): { d: string; gender: string; country: string; cat?: string } | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

interface Country { code: string; name: string; }

export function RaceFilters({
  countries,
  basePath = "/races",
}: {
  countries: Country[];
  basePath?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const [discipline, setDiscipline] = useState(sp.get("d") || "all");
  const [gender, setGender] = useState(sp.get("gender") || "all");
  const [country, setCountry] = useState(sp.get("country") || "");
  const [cat, setCat] = useState(sp.get("cat") || "all");

  useEffect(() => {
    if (sp.get("d") || sp.get("gender") || sp.get("country")) return;
    const saved = loadFilters();
    if (!saved) return;
    const d = saved.d || "all";
    const g = saved.gender || "all";
    const c = saved.country || "";
    const ct = saved.cat || "all";
    setDiscipline(d); setGender(g); setCountry(c); setCat(ct);
    if (d !== "all" || g !== "all" || c || ct !== "all") {
      router.replace(`${basePath}?${buildParams(d, g, c, ct).toString()}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function buildParams(d: string, g: string, c: string, ct: string = "all") {
    const params = new URLSearchParams();
    if (d && d !== "all") params.set("d", d);
    if (g && g !== "all") params.set("gender", g);
    if (c) params.set("country", c);
    if (ct && ct !== "all") params.set("cat", ct);
    const tab = sp.get("tab");
    if (tab) params.set("tab", tab);
    return params;
  }

  function applyFilters(d: string, g: string, c: string, ct: string = cat) {
    saveFilters(d, g, c);
    router.push(`${basePath}?${buildParams(d, g, c, ct).toString()}`);
  }

  const hasActiveFilter = discipline !== "all" || gender !== "all" || !!country;

  const pill = (active: boolean) =>
    cn(
      "px-2.5 py-0.5 text-xs font-semibold rounded-full transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground"
    );

  const divider = <span className="w-px h-3 bg-border/50 shrink-0" />;

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none min-w-0">
      {/* Discipline */}
      {(["all", "road", "mtb"] as const).map((k) => (
        <button key={k} onClick={() => { setDiscipline(k); applyFilters(k, gender, country); }} className={pill(discipline === k)}>
          {k === "all" ? "All" : k === "road" ? "Road" : "MTB"}
        </button>
      ))}

      {divider}

      {/* Gender */}
      {(["all", "men", "women"] as const).map((k) => (
        <button key={k} onClick={() => { setGender(k); applyFilters(discipline, k, country); }} className={pill(gender === k)}>
          {k === "all" ? "All" : k === "men" ? "Men" : "Women"}
        </button>
      ))}

      {divider}

      {/* Country */}
      <div className="relative shrink-0">
        <select
          value={country}
          onChange={(e) => { setCountry(e.target.value); applyFilters(discipline, gender, e.target.value); }}
          className={cn(
            "appearance-none bg-transparent pr-4 text-xs font-semibold transition-colors cursor-pointer focus:outline-none",
            country ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <option value="">Country</option>
          {countries.map(({ code, name }) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground text-[9px]">▾</span>
      </div>

      {/* Clear */}
      {hasActiveFilter && (
        <>
          {divider}
          <button
            onClick={() => { setDiscipline("all"); setGender("all"); setCountry(""); setCat("all"); applyFilters("all", "all", "", "all"); }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
