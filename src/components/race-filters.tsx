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

  const seg = (active: boolean) =>
    cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
        {(["all", "road", "mtb"] as const).map((k) => (
          <button key={k} onClick={() => { setDiscipline(k); applyFilters(k, gender, country); }} className={seg(discipline === k)}>
            {k === "all" ? "All" : k === "road" ? "Road" : "MTB"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
        {(["all", "men", "women"] as const).map((k) => (
          <button key={k} onClick={() => { setGender(k); applyFilters(discipline, k, country); }} className={seg(gender === k)}>
            {k === "all" ? "All" : k === "men" ? "Men" : "Women"}
          </button>
        ))}
      </div>

      <div className="relative">
        <select
          value={country}
          onChange={(e) => { setCountry(e.target.value); applyFilters(discipline, gender, e.target.value); }}
          className="appearance-none rounded-lg border border-border/50 bg-background px-3 py-1.5 pr-7 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">All Countries</option>
          {countries.map(({ code, name }) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">▾</span>
      </div>

      {(discipline !== "all" || gender !== "all" || country || cat !== "all") && (
        <button
          onClick={() => { setDiscipline("all"); setGender("all"); setCountry(""); setCat("all"); applyFilters("all", "all", "", "all"); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}
