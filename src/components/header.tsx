"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";

const navigation = [
  { name: "Races", href: "/races" },
  { name: "Riders", href: "/riders" },
  { name: "Teams", href: "/teams" },
];

export function Header() {
  const pathname = usePathname();
  const { isSignedIn, isLoaded } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 w-full border-t-2 border-primary bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="container mx-auto flex h-14 items-center gap-3 px-3 sm:px-6 lg:px-8 max-w-6xl">

        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="36" height="36" aria-hidden="true">
            <rect width="200" height="200" fill="#0D0D0D"/>
            <rect x="22" y="14" width="156" height="172" rx="7" fill="#FFFFFF"/>
            <circle cx="38" cy="30" r="5.5" fill="#0D0D0D"/>
            <circle cx="162" cy="30" r="5.5" fill="#0D0D0D"/>
            <circle cx="38" cy="170" r="5.5" fill="#0D0D0D"/>
            <circle cx="162" cy="170" r="5.5" fill="#0D0D0D"/>
            <text x="100" y="100" fontFamily="'Barlow Condensed','Arial Narrow',Impact,sans-serif" fontWeight="800" fontSize="122" fill="#C8102E" textAnchor="middle" dominantBaseline="middle" transform="rotate(180,100,100)">13</text>
          </svg>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">Pro Cycling</span>
            <span className="font-display text-[19px] font-extrabold uppercase tracking-tight text-primary leading-none">Predictor</span>
          </div>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* My Race Hub — primary CTA, always visible when signed in */}
        {isLoaded && isSignedIn && (
          <Link
            href="/profile"
            className={cn(
              "px-3 py-1.5 text-sm font-semibold rounded-md transition-colors whitespace-nowrap",
              pathname === "/profile" || pathname === "/my-schedule"
                ? "text-foreground bg-white/10"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            My Race Hub
          </Link>
        )}

        {/* Auth (sign in/up or avatar) */}
        {isLoaded && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {isSignedIn ? (
              <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
            ) : (
              <>
                <SignInButton mode="modal">
                  <Button variant="ghost" size="sm" className="text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 px-2 sm:px-3">
                    Sign in
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <Button size="sm" className="text-sm bg-primary text-primary-foreground hover:bg-primary/90 px-2 sm:px-3">
                    Sign up
                  </Button>
                </SignUpButton>
              </>
            )}
          </div>
        )}

        {/* Burger menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border/50 bg-background/98 shadow-xl backdrop-blur py-1.5">
              {navigation.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center px-4 py-2.5 text-sm font-medium transition-colors",
                      active ? "text-foreground bg-white/8" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
