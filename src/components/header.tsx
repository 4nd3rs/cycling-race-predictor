"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Races", href: "/races" },
  { name: "Riders", href: "/riders" },
  { name: "Teams", href: "/teams" },
];

export function Header() {
  const pathname = usePathname();
  const { isSignedIn, isLoaded } = useUser();

  return (
    <header className="sticky top-0 z-50 w-full border-t-2 border-primary bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="container mx-auto flex h-14 items-center gap-2 px-3 sm:px-6 lg:px-8 max-w-6xl">

        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2 mr-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="36" height="36" aria-hidden="true">
            <rect width="200" height="200" fill="#0D0D0D"/>
            <rect x="22" y="14" width="156" height="172" rx="7" fill="#FFFFFF"/>
            <circle cx="38" cy="30" r="5.5" fill="#0D0D0D"/>
            <circle cx="162" cy="30" r="5.5" fill="#0D0D0D"/>
            <circle cx="38" cy="170" r="5.5" fill="#0D0D0D"/>
            <circle cx="162" cy="170" r="5.5" fill="#0D0D0D"/>
            <text x="100" y="100" fontFamily="'Barlow Condensed', 'Arial Narrow', Impact, sans-serif" fontWeight="800" fontSize="122" fill="#C8102E" textAnchor="middle" dominantBaseline="middle" transform="rotate(180, 100, 100)">13</text>
          </svg>
          {/* Wordmark — hidden on very small screens */}
          <div className="hidden xs:flex sm:flex flex-col leading-none">
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
              Pro Cycling
            </span>
            <span className="font-display text-[19px] font-extrabold uppercase tracking-tight text-primary leading-none">
              Predictor
            </span>
          </div>
        </Link>

        {/* Nav — takes remaining space */}
        <nav className="flex flex-1 items-center gap-0.5 sm:gap-1 overflow-hidden">
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-2.5 sm:px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
                  active
                    ? "text-foreground bg-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Auth */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {isLoaded && (
            <>
              {isSignedIn ? (
                <div className="flex items-center gap-1 sm:gap-2">
                  <Link
                    href="/profile"
                    className={cn(
                      "hidden sm:block px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                      pathname === "/profile"
                        ? "text-foreground bg-white/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    Profile
                  </Link>
                  <UserButton
                    afterSignOutUrl="/"
                    appearance={{ elements: { avatarBox: "h-8 w-8" } }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1 sm:gap-2">
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
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
