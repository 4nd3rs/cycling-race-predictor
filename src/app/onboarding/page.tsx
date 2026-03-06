import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { Header } from "@/components/header";
import { WhatsAppGroupWidget } from "@/components/whatsapp-group-widget";
import { db, userWhatsapp } from "@/lib/db";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Get Started — Pro Cycling Predictor",
};

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?redirect_url=/onboarding");

  const [whatsappRows] = await Promise.all([
    db.select().from(userWhatsapp).where(eq(userWhatsapp.userId, user.id)).limit(1)
  ]);

  const whatsapp = whatsappRows[0] || null;
  const anyConnected = !!whatsapp?.phoneNumber;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-xl py-16">

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-10 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">✓</span>
            Account created
          </span>
          <span className="flex-1 h-px bg-border" />
          <span className={`flex items-center gap-1.5 ${anyConnected ? "text-muted-foreground" : "text-foreground"}`}>
            <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold border ${anyConnected ? "bg-primary text-primary-foreground border-primary" : "border-foreground"}`}>
              {anyConnected ? "✓" : "2"}
            </span>
            Connect alerts
          </span>
          <span className="flex-1 h-px bg-border" />
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold border border-muted-foreground">3</span>
            Follow races
          </span>
        </div>

        {/* Hero */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">Step 2 of 3</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-3">
            {anyConnected ? "You're connected." : "Connect your alerts"}
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            {anyConnected
              ? "Now follow the races and riders you care about. We'll send you a briefing before every start."
              : "Choose where you want to receive race briefings. One message before every race you follow — startlists, predictions, and intel."}
          </p>
        </div>

        {/* Connect section */}
        <div className="mb-6">
          <WhatsAppGroupWidget initialPhone={whatsapp?.phoneNumber ?? null} />
        </div>

        {/* Primary CTA */}
        <Link
          href="/races/road"
          className="block w-full text-center py-3.5 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold tracking-wide transition-colors mb-3"
        >
          {anyConnected ? "Follow your first race →" : "Skip for now — Browse races"}
        </Link>

        {!anyConnected && (
          <p className="text-center text-xs text-muted-foreground">
            You won't receive briefings until you connect an alert channel.
          </p>
        )}

        {anyConnected && (
          <p className="text-center text-xs text-muted-foreground">
            Manage alerts anytime from{" "}
            <Link href="/profile" className="underline hover:text-foreground">your profile</Link>.
          </p>
        )}

      </main>
    </div>
  );
}
