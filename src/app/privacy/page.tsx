import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Pro Cycling Predictor",
  description: "Privacy policy for Pro Cycling Predictor.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <section className="border-b border-border/50 bg-zinc-950">
        <div className="mx-auto max-w-4xl px-6 pt-8 pb-0">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
              <path fillRule="evenodd" d="M14 8a.75.75 0 0 1-.75.75H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 1.06L4.56 7.25H13.25A.75.75 0 0 1 14 8Z" clipRule="evenodd" />
            </svg>
            Back to races
          </Link>
        </div>
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: February 2026</p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-16 space-y-12 text-muted-foreground leading-relaxed">

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Who we are</h2>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">What data we collect</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-foreground">Account data</strong> — name and email address, collected via Clerk when you sign up.</li>
            <li><strong className="text-foreground">Preferences</strong> — the races and riders you choose to follow.</li>
            <li><strong className="text-foreground">Usage data</strong> — standard server logs (pages visited, timestamps). We do not use third-party analytics trackers.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">How we use your data</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>To personalise your experience based on your followed races and riders.</li>
            <li>To maintain and improve the service.</li>
          </ul>
          <p className="mt-4">We do not sell your data. We do not use it for advertising.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Third-party services</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-foreground">Clerk</strong> — authentication and account management. <a href="https://clerk.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">clerk.com/privacy</a></li>
            <li><strong className="text-foreground">WhatsApp</strong> — message delivery when you connect WhatsApp. Subject to WhatsApp&apos;s privacy policy.</li>
            <li><strong className="text-foreground">Vercel</strong> — hosting and infrastructure.</li>
            <li><strong className="text-foreground">Neon</strong> — database hosting. Data is stored in the EU.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Data retention</h2>
          <p>We retain your data for as long as your account is active. If you delete your account, your personal data is removed within 30 days. Anonymised usage data may be retained longer for service improvement.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Your rights</h2>
          <p>You can request access to, correction of, or deletion of your personal data at any time. To do so, contact us via our <a href="https://discord.gg/YaKmfkHqYu" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Discord</a> or disconnect your account through your profile settings.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Cookies</h2>
          <p>We use only essential cookies required for authentication (via Clerk). No advertising or tracking cookies are used.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-3">Changes to this policy</h2>
          <p>We may update this policy as the service evolves. We&apos;ll notify users of significant changes via the Discord community.</p>
        </section>

      </div>

      <footer className="border-t border-border/50 py-6">
        <div className="mx-auto max-w-4xl px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo@2x.png" alt="Pro Cycling Predictor" width="24" height="24" className="rounded-sm" />
            <span className="font-semibold text-foreground text-xs uppercase tracking-wide">Pro Cycling Predictor</span>
          </Link>
          <Link href="/" className="hover:text-foreground transition-colors">← Back to races</Link>
        </div>
      </footer>
    </main>
  );
}
