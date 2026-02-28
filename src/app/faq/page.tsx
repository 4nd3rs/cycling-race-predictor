import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Pro Cycling Predictor",
  description:
    "Frequently asked questions about Pro Cycling Predictor, TrueSkill ELO ratings, prediction accuracy, and race coverage.",
};

const faqs: { q: string; a: string }[] = [
  {
    q: "What is Pro Cycling Predictor?",
    a: "Pro Cycling Predictor is an AI-powered prediction engine for professional cycling. We use historical results and statistical models to generate win and podium probabilities for upcoming road and mountain bike races.",
  },
  {
    q: "How are predictions made?",
    a: "We combine TrueSkill ELO ratings with race profile analysis and recent form data. When a race startlist is confirmed, we run each rider's skill distribution through a simulation that accounts for course type, recent results, and race importance to produce win%, podium%, and top-10% probabilities.",
  },
  {
    q: "What is TrueSkill ELO?",
    a: "TrueSkill is a Bayesian rating system originally developed by Microsoft for multiplayer games. Unlike traditional ELO, it models each rider as a skill distribution — a mean rating plus an uncertainty value. This means the system can express confidence in its estimates: a veteran with hundreds of results has low uncertainty, while a neo-pro has high uncertainty. We've adapted TrueSkill for the multi-rider, multi-placement nature of cycling races.",
  },
  {
    q: "How accurate are the predictions?",
    a: "Cycling is inherently unpredictable — crashes, mechanicals, weather, and tactics all play a role. Our predictions should be read as probabilities, not certainties. A rider with a 15% win probability is the favorite, but they'll still lose more often than they win. Over time, our calibration is improving — the predicted probabilities should match real-world outcomes at scale.",
  },
  {
    q: "What races are covered?",
    a: "We cover the full UCI WorldTour and ProSeries road calendar, including Grand Tours, Monument classics, and stage races. We also cover UCI Mountain Bike Cross-Country (XCO) World Cup events and World Championships. Coverage is expanding with each season.",
  },
  {
    q: "Does it cover women's racing?",
    a: "Yes. We cover the UCI Women's WorldTour and major women's ProSeries events. The same TrueSkill model and prediction pipeline applies to both men's and women's racing with separate rating pools.",
  },
  {
    q: "What is the intel/gossip section?",
    a: "The intel section surfaces community-sourced news, rumors, and race context — things like injury updates, team tactics, weather conditions, or course changes that pure data can't capture. Think of it as the conversation you'd overhear at the team bus. It's curated by AI from news sources and community submissions.",
  },
  {
    q: "How do I give feedback?",
    a: "Join our Discord community — we'd love to hear from you. Whether it's a bug report, a feature request, or just a prediction you disagree with, all feedback helps us improve.",
  },
  {
    q: "Is it free?",
    a: "Pro Cycling Predictor is free to use during the beta period. We're focused on building the best prediction tool possible before thinking about monetization. Join the Discord to stay updated on what's coming next.",
  },
];

export default function FAQPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-border/50 bg-zinc-950">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Frequently Asked <span className="text-primary">Questions</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about how it works.
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
            href="https://discord.gg/placeholder"
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
    </main>
  );
}
