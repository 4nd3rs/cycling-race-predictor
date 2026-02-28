import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Pro Cycling Predictor",
  description:
    "Learn how Pro Cycling Predictor uses TrueSkill ELO ratings and AI to generate win probabilities and podium predictions for professional cycling races.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-border/50 bg-zinc-950">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            About <span className="text-primary">Pro Cycling Predictor</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            AI-powered race predictions for professional road and mountain bike cycling.
            Win probabilities, podium chances, and community intel — before every race.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16 space-y-20">
        {/* What is it */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            What is Pro Cycling Predictor?
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Pro Cycling Predictor is a data-driven prediction engine for professional
            cycling. We analyze historical results, current form, and race characteristics
            to generate probabilistic predictions for upcoming races. Think of it as your
            pre-race briefing — backed by math instead of gut feeling.
          </p>
        </section>

        {/* How predictions work */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            How predictions work
          </h2>
          <div className="mt-4 space-y-4 text-muted-foreground leading-relaxed">
            <p>
              At the core of our system is a <strong className="text-foreground">TrueSkill ELO</strong> rating
              — a Bayesian skill estimation model originally developed by Microsoft for
              multiplayer gaming, adapted here for professional cycling.
            </p>
            <p>
              Unlike traditional ELO which only handles head-to-head matchups, TrueSkill
              models each rider as a probability distribution (a bell curve of skill). Every
              race result updates each rider&apos;s skill estimate and uncertainty. A rider
              who consistently finishes near the top will have a high rating with low
              uncertainty. A rider returning from injury might have a high rating but
              with wider uncertainty bounds.
            </p>
            <p>
              When we generate predictions for an upcoming race, we take the confirmed
              startlist, pull each rider&apos;s current TrueSkill rating, and factor in:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-foreground">Race profile compatibility</strong> — how
                well the rider&apos;s historical results match the course type (flat, hilly,
                mountainous, time trial)
              </li>
              <li>
                <strong className="text-foreground">Recent form</strong> — weighted performance
                in the last few weeks of racing
              </li>
              <li>
                <strong className="text-foreground">Race importance</strong> — UCI category and
                historical prestige
              </li>
            </ul>
            <p>
              The result is a set of probabilities: win%, podium%, and top-10% for every
              rider on the startlist.
            </p>
          </div>
        </section>

        {/* What you get */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            What you get
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <div className="text-2xl font-display font-bold text-primary">Win%</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Probability of winning the race. Our headline number — who&apos;s the most
                likely victor?
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <div className="text-2xl font-display font-bold text-primary">Podium%</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Chance of finishing in the top 3. Great for spotting dark horses who might
                not win but are likely to be up there.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <div className="text-2xl font-display font-bold text-primary">Intel</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Community-sourced gossip, news, and insider info — race context that
                numbers alone can&apos;t capture.
              </p>
            </div>
          </div>
        </section>

        {/* Road & MTB coverage */}
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Road &amp; MTB coverage
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            We cover the full UCI WorldTour and ProSeries road calendar — from
            Monument classics like Paris-Roubaix to Grand Tours. We also cover
            UCI Mountain Bike Cross-Country (XCO) World Cup and World Championships.
            Coverage is expanding — if a race has a startlist and UCI ranking points,
            we&apos;re working to include it.
          </p>
        </section>

        {/* Beta notice */}
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-8 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            We&apos;re in beta
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Pro Cycling Predictor is under active development. Predictions are
            improving with every race. We&apos;d love your feedback — join the
            community on Discord to report issues, request features, or just talk
            racing.
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
    </main>
  );
}
