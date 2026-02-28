import type { Metadata } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { Footer } from "@/components/Footer";
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
  title: "Pro Cycling Predictor — Race Briefings on WhatsApp & Telegram",
  description:
    "Follow your favourite races and riders. Get a personalised race briefing on WhatsApp or Telegram before every start — startlists, predictions, rider intel, and weather.",
  metadataBase: new URL("https://procyclingpredictor.com"),
  openGraph: {
    title: "Pro Cycling Predictor — Race Briefings on WhatsApp & Telegram",
    description:
      "Follow your favourite races and riders. Get a personalised race briefing on WhatsApp or Telegram before every start.",
    type: "website",
    url: "https://procyclingpredictor.com",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Pro Cycling Predictor — Race briefings on WhatsApp & Telegram",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pro Cycling Predictor — Race Briefings on WhatsApp & Telegram",
    description:
      "Personalised race briefings on WhatsApp or Telegram. Startlists, predictions, rider intel — before every race.",
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
          <Footer />
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
