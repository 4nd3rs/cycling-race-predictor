import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Pro Cycling Predictor",
  description:
    "Pro Cycling Predictor sends personalised race briefings to your Telegram — before every race you follow. Backed by TrueSkill predictions and live intel.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-border/50 bg-zinc-950">
        <div className="mx-auto max-w-4xl px-6 pt-8 pb-0">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
              <path fillRule="evenodd" d="M14 8a.75.75 0 0 1-.75.75H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 1.06L4.56 7.25H13.25A.75.75 0 0 1 14 8Z" clipRule="evenodd" />
            </svg>
            Back to races
          </Link>
        </div>
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Your personal cycling <span className="text-primary">race briefing</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Follow your favourite races and riders. Get a personalised briefing on{" "}
            <strong className="text-foreground">WhatsApp</strong> or{" "}
            <strong className="text-foreground">Telegram</strong> before every start —
            no app to open, no feed to check.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16 space-y-20">
        {/* Core feature — notifications */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Race briefings, delivered to your chat
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Pro Cycling Predictor is built around one idea: you shouldn't have to go
            looking for race information. Follow a race and we'll send you everything
            you need — who's on the startlist, who to watch, key intel, and a weather
            check — right before it kicks off. Delivered via Telegram, so
            it lands where you already are.
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-primary mb-2">WhatsApp &amp; Telegram</h3>
              <p className="text-sm text-muted-foreground">
                No app to install. Connect once, follow the races you care about, and
                briefings arrive automatically before each start.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-primary mb-2">Personalised to you</h3>
              <p className="text-sm text-muted-foreground">
                Follow specific races and riders. Your briefings are filtered to what
                you actually follow — not a generic newsletter.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-primary mb-2">Before every race</h3>
              <p className="text-sm text-muted-foreground">
                Timed to land a few hours before the race starts — so you're always
                informed, even on a busy race weekend.
              </p>
            </div>
          </div>
        </section>

        {/* What's in a briefing */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            What's in a briefing?
          </h2>
          <div className="mt-4 space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Each briefing is built from live data and distilled into a short, readable message:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-foreground">Predictions</strong> — win%, podium%, and
                top-10% for the key riders, powered by TrueSkill ELO ratings
              </li>
              <li>
                <strong className="text-foreground">Startlist highlights</strong> — confirmed
                starters and notable absences
              </li>
              <li>
                <strong className="text-foreground">Rider intel</strong> — recent form, injuries,
                team dynamics, community gossip
              </li>
              <li>
                <strong className="text-foreground">Weather</strong> — conditions at the race
                location on race day
              </li>
            </ul>
          </div>
        </section>

        {/* How predictions work — secondary */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            How the predictions work
          </h2>
          <div className="mt-4 space-y-4 text-muted-foreground leading-relaxed">
            <p>
              The predictions powering each briefing are built on a{" "}
              <strong className="text-foreground">TrueSkill ELO</strong> model — a Bayesian
              skill estimation system originally developed by Microsoft for multiplayer
              gaming, adapted here for pro cycling. Every race result updates each
              rider's rating. When a startlist drops, we simulate the race using current
              ratings, course type, and recent form to generate win%, podium%, and top-10%
              for every starter.
            </p>
            <p>
              It's not perfect — cycling is chaotic — but it's a strong, data-grounded
              starting point for any pre-race conversation.
            </p>
          </div>
        </section>

        {/* Coverage */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Road &amp; MTB coverage
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            We cover the full UCI WorldTour and ProSeries road calendar — from Monument
            classics like Paris-Roubaix to Grand Tours. We also cover UCI Mountain Bike
            Cross-Country (XCO) World Cup and World Championships. Coverage is expanding —
            if a race has a startlist and UCI ranking points, we're working to include it.
          </p>
        </section>

        {/* Creator */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Who built this
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <a
              href="https://www.instagram.com/anders.m.andersen/"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 group"
            >
              <div className="h-14 w-14 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5">
                <div className="h-full w-full rounded-full bg-background flex items-center justify-center text-xl font-bold text-foreground group-hover:opacity-80 transition-opacity">
                  A
                </div>
              </div>
            </a>
            <div>
              <p className="font-semibold text-foreground">
                <a
                  href="https://www.instagram.com/anders.m.andersen/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  Anders Andersen
                </a>
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Creator &amp; developer. Cyclist, data nerd, and the person behind Pro Cycling Predictor.{" "}
                <a
                  href="https://www.instagram.com/anders.m.andersen/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground transition-colors"
                >
                  @anders.m.andersen
                </a>{" "}
                on Instagram.
              </p>
            </div>
          </div>
        </section>

        {/* Beta notice */}
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-8 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            We&apos;re in beta
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Pro Cycling Predictor is under active development. Briefings and predictions
            are improving with every race. We'd love your feedback — join the community
            on Discord to report issues, request features, or just talk racing.
          </p>
          <a
            href="https://discord.gg/YaKmfkHqYu"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Join the Discord
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="size-4"
            >
              <path
                fillRule="evenodd"
                d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </section>
      </div>
      {/* Footer */}
      <footer className="border-t border-border/50 py-6 mt-8">
        <div className="mx-auto max-w-4xl px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo@2x.png" alt="Pro Cycling Predictor" width="24" height="24" className="rounded-sm" />
            <span className="font-semibold text-foreground text-xs uppercase tracking-wide">Pro Cycling Predictor</span>
          </Link>
          <p>
            Data from{" "}
            <a href="https://www.procyclingstats.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              ProCyclingStats
            </a>
          </p>
          <Link href="/" className="hover:text-foreground transition-colors">← Back to races</Link>
        </div>
      </footer>
    </main>
  );
}
