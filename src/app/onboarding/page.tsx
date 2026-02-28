import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { Header } from "@/components/header";
import { ConnectTelegramButton } from "@/components/connect-telegram-button";
import { ConnectWhatsAppButton } from "@/components/connect-whatsapp-button";
import { db, userTelegram, userWhatsapp } from "@/lib/db";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Get Started — Pro Cycling Predictor",
};

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?redirect_url=/onboarding");

  const [telegramRows, whatsappRows] = await Promise.all([
    db.select().from(userTelegram).where(eq(userTelegram.userId, user.id)).limit(1),
    db.select().from(userWhatsapp).where(eq(userWhatsapp.userId, user.id)).limit(1),
  ]);

  const telegram = telegramRows[0] || null;
  const whatsapp = whatsappRows[0] || null;
  const anyConnected = !!telegram?.connectedAt || !!whatsapp?.connectedAt;

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

              <div className="border-t border-border/50" />

              {/* WhatsApp */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <p className="font-semibold text-sm">WhatsApp</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Requires a one-time activation step.</p>
                </div>
                <ConnectWhatsAppButton connected={false} phoneNumber={null} />
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
            {whatsapp?.connectedAt && (
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-[#25D366] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <span className="text-sm font-medium">WhatsApp connected</span>
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
