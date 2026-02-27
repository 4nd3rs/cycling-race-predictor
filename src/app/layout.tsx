import type { Metadata } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Pro Cycling Predictor — AI Race Predictions",
  description:
    "AI-powered cycling race predictions using TrueSkill ELO ratings, form analysis, and community intel. Win probabilities, podium chances, and more.",
  metadataBase: new URL("https://procyclingpredictor.com"),
  openGraph: {
    title: "Pro Cycling Predictor — AI Race Predictions",
    description:
      "AI-powered cycling race predictions using TrueSkill ELO ratings, form analysis, and community intel.",
    type: "website",
    url: "https://procyclingpredictor.com",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 300,
        alt: "Pro Cycling Predictor",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pro Cycling Predictor — AI Race Predictions",
    description:
      "AI-powered cycling race predictions. Win probabilities, podium chances, and community intel.",
    images: ["/opengraph-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider afterSignUpUrl="/onboarding">
      <html lang="en" className="dark">
        <body
          className={`${inter.variable} ${barlowCondensed.variable} antialiased`}
        >
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
