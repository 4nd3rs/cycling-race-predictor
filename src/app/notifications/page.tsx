import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/Footer";
import { WhatsAppGroupWidget } from "@/components/whatsapp-group-widget";
import { getAuthUser } from "@/lib/auth";
import { db, userWhatsapp } from "@/lib/db";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Race Notifications — Pro Cycling Predictor",
  description:
    "Get race predictions, podium results and breaking news for every WorldTour race — delivered straight to your WhatsApp.",
};

export default async function NotificationsPage() {
  const user = await getAuthUser().catch(() => null);

  const whatsappRows = user
    ? await db.select().from(userWhatsapp).where(eq(userWhatsapp.userId, user.id)).limit(1)
    : [];
  const whatsapp = whatsappRows[0] ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <main className="flex-1">

        {/* Hero */}
        <section className="border-b border-border/50 bg-zinc-950">
          <div className="mx-auto max-w-3xl px-6 py-20 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-green-500/10 border border-green-500/20 px-4 py-1.5 text-sm font-medium text-green-400 mb-6">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp Group
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">
              Race updates in your WhatsApp
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
              Join the Pro Cycling Predictor Road group. Enter your number and we&apos;ll send you the invite — no public link, registered members only.
            </p>

            {/* CTA — auth-aware */}
            <div className="max-w-md mx-auto">
              {user ? (
                <WhatsAppGroupWidget initialPhone={whatsapp?.phoneNumber ?? null} initialFrequency={whatsapp?.notificationFrequency ?? "key-moments"} />
              ) : (
                <div className="rounded-lg border border-border/50 bg-card/20 p-5 space-y-3 text-left">
                  <p className="text-sm font-medium">Create a free account to join</p>
                  <p className="text-xs text-muted-foreground">
                    We verify members before sending the group invite — takes 30 seconds to sign up.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Link
                      href="/sign-up?redirect_url=/notifications"
                      className="flex-1 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Create free account
                    </Link>
                    <Link
                      href="/sign-in?redirect_url=/notifications"
                      className="flex-1 inline-flex items-center justify-center rounded-md border border-border/50 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                    >
                      Sign in
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* What you get */}
        <section className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight mb-8 text-center">What you get</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-border/50 bg-card/30 p-6">
              <div className="text-2xl mb-3">🔮</div>
              <h3 className="font-semibold mb-2">Race Previews</h3>
              <p className="text-sm text-muted-foreground">
                48 hours before every WorldTour race — our top picks, win probabilities, and key intel on who to watch.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/30 p-6">
              <div className="text-2xl mb-3">🏆</div>
              <h3 className="font-semibold mb-2">Podium Results</h3>
              <p className="text-sm text-muted-foreground">
                Same evening as the finish — the top 3, how the race unfolded, and how well our predictions held up.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/30 p-6">
              <div className="text-2xl mb-3">🌅</div>
              <h3 className="font-semibold mb-2">Race Day Hype</h3>
              <p className="text-sm text-muted-foreground">
                Morning of every race — a quick briefing with our top pick and what to expect from the day.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/30 p-6">
              <div className="text-2xl mb-3">🔴</div>
              <h3 className="font-semibold mb-2">Breaking News</h3>
              <p className="text-sm text-muted-foreground">
                Injuries, withdrawals, late scratches — important race news delivered within hours of breaking.
              </p>
            </div>
          </div>
        </section>

        {/* How to join */}
        <section className="border-t border-border/50 bg-zinc-950/60">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-2xl font-bold tracking-tight mb-8 text-center">How it works</h2>
            <ol className="space-y-6">
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">1</span>
                <div>
                  <p className="font-medium">Create a free account</p>
                  <p className="text-sm text-muted-foreground mt-0.5">Sign up — takes 30 seconds, no credit card needed.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">2</span>
                <div>
                  <p className="font-medium">Enter your WhatsApp number</p>
                  <p className="text-sm text-muted-foreground mt-0.5">Add your number on this page or in your profile. We&apos;ll send you a private invite link via WhatsApp DM.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">3</span>
                <div>
                  <p className="font-medium">Join via the invite we send you</p>
                  <p className="text-sm text-muted-foreground mt-0.5">Tap the link in your DM. Race updates start from the next WorldTour race.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight mb-8">Questions</h2>
          <dl className="space-y-6">
            {[
              { q: "Is it free?", a: "Yes. The WhatsApp group is completely free for all registered users." },
              { q: "How often will I get messages?", a: "On WorldTour race days: 3–4 messages (preview, race morning, results). Between races: only if something important breaks. No spam." },
              { q: "Which races are covered?", a: "All UCI WorldTour and Women's WorldTour road races — monuments, Grand Tours, stage races. More categories coming." },
              { q: "Why do I need to register?", a: "We verify members to keep the group quality high. No public invite link — everyone in the group has a registered account." },
              { q: "Can I leave?", a: "Of course — just leave the WhatsApp group at any time. No questions asked." },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-border/50 pb-6">
                <dt className="font-semibold mb-1">{q}</dt>
                <dd className="text-sm text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

      </main>
      <Footer />
    </div>
  );
}
