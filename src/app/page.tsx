import Link from "next/link";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="container py-24 md:py-32">
          <div className="flex flex-col items-center text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
                AI-Powered Cycling
                <br />
                <span className="text-primary">Race Predictions</span>
              </h1>
              <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl">
                Using TrueSkill ELO ratings, form analysis, and community intel
                to predict race outcomes. Win probabilities, podium chances, and
                more.
              </p>
            </div>
            <div className="flex gap-4">
              <Button asChild size="lg">
                <Link href="/races">View Predictions</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/riders">Browse Riders</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="container py-16 border-t">
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">📊</span>
                  TrueSkill ELO Ratings
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Bayesian skill estimation adapted from Microsoft&apos;s TrueSkill
                algorithm. Handles 200+ rider races through intelligent sampling.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">📈</span>
                  Form & Profile Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Recent form calculation with time decay. Race profile matching
                for flat, hilly, mountain, TT, and cobbled races.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">🔥</span>
                  Community Intel
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                AI-parsed tips and rumors from the community. Injury reports,
                form insights, and team dynamics factor into predictions.
              </CardContent>
            </Card>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="container py-16 border-t">
          <h2 className="text-3xl font-bold text-center mb-12">
            How It Works
          </h2>
          <div className="grid gap-8 md:grid-cols-4">
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                1
              </div>
              <h3 className="font-semibold">Base ELO</h3>
              <p className="text-sm text-muted-foreground">
                TrueSkill-based ratings from historical race results since 2020
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                2
              </div>
              <h3 className="font-semibold">Profile Match</h3>
              <p className="text-sm text-muted-foreground">
                Rider affinity for race profile (climbing, sprinting, TT)
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                3
              </div>
              <h3 className="font-semibold">Recent Form</h3>
              <p className="text-sm text-muted-foreground">
                Weighted results from last 90 days with exponential decay
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                4
              </div>
              <h3 className="font-semibold">Community Intel</h3>
              <p className="text-sm text-muted-foreground">
                AI-parsed tips with max 5% impact, corroboration bonuses
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container py-16 border-t">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="py-12 text-center space-y-6">
              <h2 className="text-3xl font-bold">
                Start Predicting Races Today
              </h2>
              <p className="text-primary-foreground/80 max-w-xl mx-auto">
                Sign up to submit your own tips, add new races, and join
                discussions with the cycling community.
              </p>
              <div className="flex justify-center gap-4">
                <Button asChild size="lg" variant="secondary">
                  <Link href="/races">Browse Races</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-primary-foreground/20 hover:bg-primary-foreground/10">
                  <Link href="/sign-up">Create Account</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <p>
            Data from{" "}
            <a
              href="https://www.procyclingstats.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              ProCyclingStats
            </a>
          </p>
          <p>
            Built with Next.js, TrueSkill, and Gemini AI
          </p>
        </div>
      </footer>
    </div>
  );
}
