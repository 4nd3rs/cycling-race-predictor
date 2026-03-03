import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { Header } from "@/components/header";
import { ConnectTelegramButton } from "@/components/connect-telegram-button";
import { db, userTelegram } from "@/lib/db";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Get Started — Pro Cycling Predictor",
};

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?redirect_url=/onboarding");

  const [telegramRows] = await Promise.all([
    db.select().from(userTelegram).where(eq(userTelegram.userId, user.id)).limit(1)
  ]);

  const telegram = telegramRows[0] || null;
  const anyConnected = !!telegram?.connectedAt;

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
        {!anyConnected && (
          <div className="rounded-xl border border-border/50 bg-card/40 p-6 mb-6">
            <div className="space-y-6">
              {/* Telegram */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-[#26A5E4]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                    <p className="font-semibold text-sm">Telegram</p>
                    
                  </div>
                  <p className="text-xs text-muted-foreground">Free, instant. No phone number needed.</p>
                </div>
                <ConnectTelegramButton />
              </div>


            </div>
          </div>
        )}

        {/* Connected state — show which are connected */}
        {anyConnected && (
          <div className="rounded-xl border border-border/50 bg-card/40 p-6 mb-6 space-y-4">
            {telegram?.connectedAt && (
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-[#26A5E4] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                <span className="text-sm font-medium">Telegram connected</span>
                <span className="ml-auto text-xs text-green-500 font-semibold">Active</span>
              </div>
            )}
          </div>
        )}

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
