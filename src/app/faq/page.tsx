import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ — Pro Cycling Predictor",
  description:
};

const faqs: { q: string; a: string | React.ReactNode }[] = [
  {
    q: "What is Pro Cycling Predictor?",
  },
  {
    q: "How do the notifications work?",
  },
  {
    q: "Which platforms are supported for notifications?",
  },
  {
    q: "What's in a race briefing?",
    a: "Each briefing includes: the confirmed startlist, TrueSkill win/podium predictions for the key riders, recent rider intel (form, injuries, team news), and a weather check for race day. It's everything you'd want to know before the gun fires — in one short message.",
  },
  {
    q: "How are predictions made?",
    a: "We use TrueSkill ELO — a Bayesian skill model adapted from multiplayer gaming — combined with race profile analysis and recent form. When a startlist is confirmed, we generate win%, podium%, and top-10% probabilities for every starter. These predictions power the briefings you receive.",
  },
  {
    q: "What is TrueSkill ELO?",
    a: "TrueSkill is a rating system originally developed by Microsoft. Unlike traditional ELO, it models each rider as a skill distribution with a mean rating and an uncertainty value. A veteran with hundreds of results has low uncertainty; a neo-pro has high uncertainty. Every race result updates each rider's rating.",
  },
  {
    q: "How accurate are the predictions?",
    a: "Cycling is unpredictable — crashes, tactics, weather, and form all play a role. Our predictions are probabilities, not certainties. A rider with a 15% win probability is the favourite, but they'll still lose more often than they win. Over time, calibration improves as more race data accumulates.",
  },
  {
    q: "What races are covered?",
    a: "The full UCI WorldTour and ProSeries road calendar — Grand Tours, Monuments, stage races. Plus UCI Mountain Bike Cross-Country (XCO) World Cup and World Championships. Women's WorldTour is also covered with separate rating pools.",
  },
  {
    q: "What is the intel section?",
    a: "Intel surfaces community-sourced news, rumours, and race context — injury updates, team tactics, course changes — things pure data can't capture. Curated by AI from news sources. It feeds into your pre-race briefings.",
  },
  {
    q: "Is it free?",
    a: "Yes, free during beta. We're focused on making the briefings as useful as possible before thinking about pricing. Join the Discord to stay updated.",
  },
];

export default function FAQPage() {
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
            Frequently Asked <span className="text-primary">Questions</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about race briefings, notifications, and predictions.
          </p>
        </div>
      </section>

      {/* FAQ List */}
      <div className="mx-auto max-w-3xl px-6 py-16">
        <dl className="space-y-10">
          {faqs.map((faq, i) => (
            <div key={i}>
              <dt className="font-display text-lg font-bold tracking-tight">
                {faq.q}
              </dt>
              <dd className="mt-2 text-muted-foreground leading-relaxed">
                {faq.a}
              </dd>
            </div>
          ))}
        </dl>

        {/* Discord CTA */}
        <div className="mt-16 rounded-xl border border-border/50 bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Still have questions?
          </p>
          <a
            href="https://discord.gg/YaKmfkHqYu"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Ask on Discord
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
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6">
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
