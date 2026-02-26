"use client";

import Link from "next/link";
import Image from "next/image";
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
      <div className="container mx-auto flex h-16 items-center px-4 sm:px-6 lg:px-8 max-w-6xl">

        {/* Left: Brand */}
        <div className="mr-6 flex shrink-0">
          <Link href="/" className="flex items-center gap-3">
            {/* Bib icon */}
            <Image
              src="/logo-square.png"
              alt="Pro Cycling Predictor"
              width={44}
              height={44}
              className="rounded-sm"
            />
            {/* Wordmark */}
            <div className="flex flex-col leading-none">
              <span className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground">
                Pro Cycling
              </span>
              <span className="font-display text-[22px] font-extrabold uppercase tracking-tight text-primary leading-none">
                Predictor
              </span>
            </div>
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
                  ? "text-foreground bg-white/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Right: Auth */}
        <div className="flex shrink-0 items-center gap-2">
          {isLoaded && (
            <>
              {isSignedIn ? (
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: { avatarBox: "h-8 w-8" },
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <SignInButton mode="modal">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-white/10">
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
