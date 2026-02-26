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

const authNavigation = [
  { name: "Add Race", href: "/races/new" },
];

export function Header() {
  const pathname = usePathname();
  const { isSignedIn, isLoaded, user } = useUser();
  const isAdmin = user?.publicMetadata?.role === "admin";

  return (
    <header className="sticky top-0 z-50 w-full border-t-2 border-primary bg-secondary text-secondary-foreground backdrop-blur supports-[backdrop-filter]:bg-secondary/95">
      <div className="container mx-auto flex h-14 items-center px-4 sm:px-6 lg:px-8 max-w-6xl">
        {/* Left: Brand */}
        <div className="mr-6 flex shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight text-white">
              ProCycling
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
              Predictor
            </span>
          </Link>
        </div>

        {/* Center: Nav */}
        <nav className="flex flex-1 items-center justify-center gap-1">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "text-white bg-white/10"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              {item.name}
            </Link>
          ))}
          {isSignedIn &&
            authNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  pathname === item.href
                    ? "text-white bg-white/10"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                )}
              >
                {item.name}
              </Link>
            ))}
          {isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                pathname.startsWith("/admin")
                  ? "text-white bg-white/10"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              Admin
            </Link>
          )}
        </nav>

        {/* Right: Auth */}
        <div className="flex shrink-0 items-center gap-2">
          {isLoaded && (
            <>
              {isSignedIn ? (
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      avatarBox: "h-8 w-8",
                    },
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <SignInButton mode="modal">
                    <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10">
                      Sign In
                    </Button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                      Sign Up
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
