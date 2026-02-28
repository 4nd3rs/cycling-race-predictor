import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-zinc-950 border-t border-border/50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          {/* Left: Wordmark + Tagline */}
          <Link href="/" className="flex flex-col gap-1 hover:opacity-80 transition-opacity">
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              Pro Cycling Predictor
            </span>
            <span className="text-xs text-muted-foreground">
              AI-powered race predictions
            </span>
          </Link>

          {/* Center: Links */}
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link href="/about" className="hover:text-foreground transition-colors">
              About
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <Link href="/faq" className="hover:text-foreground transition-colors">
              FAQ
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <a
              href="https://t.me/procyclingpredictions"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Telegram
            </a>
            <span className="hidden sm:inline text-border">·</span>
            <a
              href="https://wa.me/16812710565"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              WhatsApp
            </a>
            <span className="hidden sm:inline text-border">·</span>
            <a
              href="https://discord.gg/YaKmfkHqYu"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Discord
              <span className="ml-1 text-xs text-primary font-medium">(beta)</span>
            </a>
          </nav>

          {/* Right: Copyright */}
          <p className="text-xs text-muted-foreground">
            &copy; 2026 Pro Cycling Predictor
          </p>
        </div>
      </div>
    </footer>
  );
}
