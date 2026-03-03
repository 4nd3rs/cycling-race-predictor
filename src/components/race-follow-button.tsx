"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, Loader2, Bell, BellOff, ChevronDown } from "lucide-react";
import { formatCategoryDisplay } from "@/lib/category-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface RaceCategory {
  id: string; // race ID (specific category)
  ageCategory: string;
  gender: string;
  categorySlug?: string | null;
}

interface RaceFollowButtonProps {
  eventId: string;       // race_event ID — "follow all"
  eventName: string;
  categories: RaceCategory[];
  className?: string;
  size?: "sm" | "default";
  compact?: boolean;
  initialFollowing?: boolean; // server-provided optimistic initial state
}

type FollowState = "idle" | "loading" | "toggling";

async function checkFollow(followType: string, entityId: string): Promise<boolean> {
  const res = await fetch(`/api/follows/check?followType=${followType}&entityId=${entityId}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.following as boolean;
}

async function setFollow(followType: string, entityId: string, follow: boolean): Promise<boolean> {
  const res = await fetch("/api/follows", {
    method: follow ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ followType, entityId }),
  });
  return res.ok;
}

export function RaceFollowButton({
  eventId,
  eventName,
  categories,
  className,
  size = "sm",
  compact = false,
  initialFollowing,
}: RaceFollowButtonProps) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();

  // Use initialFollowing as an optimistic pre-render value to avoid flash,
  // but always verify from API on mount.
  const initMap = initialFollowing !== undefined
    ? { [`race_event:${eventId}`]: initialFollowing }
    : {};
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>(initMap);
  const [state, setState] = useState<FollowState>(initialFollowing !== undefined ? "idle" : "loading");
  const [open, setOpen] = useState(false);

  const isFollowingAll = !!followingMap[`race_event:${eventId}`];
  const isFollowingAny =
    isFollowingAll ||
    categories.some((c) => !!followingMap[`race:${c.id}`]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState("idle");
      return;
    }

    // Always verify follow state from API — never trust initialFollowing alone.
    // initialFollowing is only used as the optimistic initial render value.
    const keys = [
      { type: "race_event", id: eventId },
      ...categories.map((c) => ({ type: "race", id: c.id })),
    ];

    Promise.all(keys.map((k) => checkFollow(k.type, k.id).then((v) => ({ key: `${k.type}:${k.id}`, v }))))
      .then((results) => {
        const map: Record<string, boolean> = {};
        results.forEach(({ key, v }) => { map[key] = v; });
        setFollowingMap(map);
        setState("idle");
      })
      .catch(() => setState("idle"));
  }, [isLoaded, isSignedIn, eventId]); // eslint-disable-line

  function handleNotSignedIn() {
    router.push("/sign-in");
  }

  async function toggleAll() {
    if (!isSignedIn) { handleNotSignedIn(); return; }
    setState("toggling");
    const newState = !isFollowingAll;
    await setFollow("race_event", eventId, newState);
    setFollowingMap((m) => ({ ...m, [`race_event:${eventId}`]: newState }));
    setState("idle");
    setOpen(false);

    if (newState) {
      toast.success(`Following ${eventName}`, {
        description: "You'll get predictions, results and breaking news.",
        duration: 4000,
      });
    } else {
      toast(`Unfollowed ${eventName}`);
    }
  }

  async function toggleCategory(cat: RaceCategory) {
    if (!isSignedIn) { handleNotSignedIn(); return; }
    setState("toggling");
    const key = `race:${cat.id}`;
    const newState = !followingMap[key];
    await setFollow("race", cat.id, newState);
    setFollowingMap((m) => ({ ...m, [key]: newState }));
    setState("idle");

    const categoryLabel = formatCategoryDisplay(cat.ageCategory, cat.gender);
    if (newState) {
      toast.success(`Following ${categoryLabel} — ${eventName}`, {
        description: "You'll get updates for this category.",
        duration: 4000,
      });
    } else {
      toast(`Unfollowed ${categoryLabel} — ${eventName}`);
    }
  }

  // Compact: icon-only bell — opens category picker popover (or toggles directly if no categories)
  if (compact) {
    if (categories.length === 0) {
      return (
        <button
          onClick={toggleAll}
          disabled={state === "toggling"}
          title={isFollowingAny ? "Following — click to unfollow" : "Follow"}
          className={cn("h-5 w-5 flex items-center justify-center text-muted-foreground transition-colors hover:text-primary", isFollowingAny && "text-primary", className)}
        >
          <Bell className={"h-3.5 w-3.5" + (isFollowingAny ? " fill-current" : "")} />
        </button>
      );
    }
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={state === "toggling"}
            title={isFollowingAny ? "Following — click to change" : "Follow"}
            className={cn("h-5 w-5 flex items-center justify-center text-muted-foreground transition-colors hover:text-primary", isFollowingAny && "text-primary", className)}
            onClick={(e) => {
              if (!isSignedIn) { e.preventDefault(); handleNotSignedIn(); return; }
            }}
          >
            <Bell className={"h-3.5 w-3.5" + (isFollowingAny ? " fill-current" : "")} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="end">
          <p className="text-xs text-muted-foreground font-medium px-2 py-1 mb-1 truncate">{eventName}</p>
          <button
            onClick={toggleAll}
            disabled={state === "toggling"}
            className={cn("flex items-center justify-between w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors", isFollowingAll && "text-primary font-medium")}
          >
            <span>All categories</span>
            {isFollowingAll && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="my-1 border-t border-border/50" />
          {categories
            .sort((a, b) => {
              const o = { elite: 0, u23: 1, junior: 2, masters: 3 };
              return (o[a.ageCategory as keyof typeof o] ?? 4) - (o[b.ageCategory as keyof typeof o] ?? 4) || (a.gender === "men" ? -1 : 1);
            })
            .map((cat) => {
              const key = `race:${cat.id}`;
              const isFollowing = !!followingMap[key] || isFollowingAll;
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat)}
                  disabled={state === "toggling" || isFollowingAll}
                  className={cn("flex items-center justify-between w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors", isFollowing && "text-primary font-medium", isFollowingAll && "opacity-50 cursor-not-allowed")}
                >
                  <span>{formatCategoryDisplay(cat.ageCategory, cat.gender)}</span>
                  {isFollowing && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
        </PopoverContent>
      </Popover>
    );
  }

  // Single category — simple toggle, no popup
  if (categories.length <= 1) {
    return (
      <button
        onClick={toggleAll}
        disabled={state !== "idle"}
        className={cn(
          "inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-medium border transition-colors shrink-0",
          isFollowingAny
            ? "border-primary text-primary bg-primary/15 hover:bg-primary/25"
            : "border-white/30 text-white/80 bg-white/8 hover:bg-white/15 hover:border-white/50",
          className
        )}
      >
        {state === "loading" || state === "toggling" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isFollowingAny ? (
          <><Bell className="h-3 w-3 fill-current" /><span>Following</span></>
        ) : (
          <><Bell className="h-3 w-3" /><span>Follow</span></>
        )}
      </button>
    );
  }

  // Multiple categories — popover picker
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={state === "loading"}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-medium border transition-colors shrink-0",
            isFollowingAny
              ? "border-primary text-primary bg-primary/15 hover:bg-primary/25"
              : "border-white/30 text-white/80 bg-white/8 hover:bg-white/15 hover:border-white/50",
            className
          )}
          onClick={(e) => {
            if (!isSignedIn) { e.preventDefault(); handleNotSignedIn(); return; }
          }}
        >
          {state === "loading" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isFollowingAny ? (
            <><Bell className="h-3 w-3 fill-current" /><span>Following</span><ChevronDown className="h-3 w-3" /></>
          ) : (
            <><Bell className="h-3 w-3" /><span>Follow</span><ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <p className="text-xs text-muted-foreground font-medium px-2 py-1 mb-1">
          Follow {eventName}
        </p>

        {/* Follow All */}
        <button
          onClick={toggleAll}
          disabled={state === "toggling"}
          className={cn(
            "flex items-center justify-between w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors",
            isFollowingAll && "text-primary font-medium"
          )}
        >
          <span>All categories</span>
          {isFollowingAll && <Check className="h-3.5 w-3.5" />}
        </button>

        <div className="my-1 border-t border-border/50" />

        {/* Per-category */}
        {categories
          .sort((a, b) => {
            const o = { elite: 0, u23: 1, junior: 2, masters: 3 };
            const ao = o[a.ageCategory as keyof typeof o] ?? 4;
            const bo = o[b.ageCategory as keyof typeof o] ?? 4;
            return ao !== bo ? ao - bo : (a.gender === "men" ? -1 : 1);
          })
          .map((cat) => {
            const key = `race:${cat.id}`;
            const isFollowing = !!followingMap[key] || isFollowingAll;
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat)}
                disabled={state === "toggling" || isFollowingAll}
                className={cn(
                  "flex items-center justify-between w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                  isFollowing && "text-primary font-medium",
                  isFollowingAll && "opacity-50 cursor-not-allowed"
                )}
              >
                <span>{formatCategoryDisplay(cat.ageCategory, cat.gender)}</span>
                {isFollowing && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
      </PopoverContent>
    </Popover>
  );
}
