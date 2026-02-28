"use client";

import { useUser, SignInButton } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { label: "Both", value: "all" },
  { label: "Road", value: "road" },
  { label: "MTB", value: "mtb" },
] as const;

type Option = (typeof OPTIONS)[number]["value"];

export function DisciplineSwitch({ current }: { current: string }) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(value: Option) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("d");
    } else {
      params.set("d", value);
    }
    router.push(`/?${params.toString()}`);
  }

  const active = OPTIONS.find((o) => o.value === current) ? (current as Option) : "all";

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/10 p-1 w-fit">
      {OPTIONS.map((opt) => {
        const isActive = active === opt.value;
        const needsAuth = opt.value !== "all" && isLoaded && !isSignedIn;

        const className = cn(
          "px-5 py-1.5 text-sm font-semibold rounded-md transition-colors tracking-wide",
          isActive
            ? "bg-background text-foreground shadow-sm border border-border/40"
            : "text-muted-foreground hover:text-foreground"
        );

        if (needsAuth) {
          return (
            <SignInButton key={opt.value} mode="modal">
              <button className={className}>{opt.label}</button>
            </SignInButton>
          );
        }

        return (
          <button key={opt.value} onClick={() => navigate(opt.value)} className={className}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
