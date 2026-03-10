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
  title: "Pro Cycling Predictor — AI Race Predictions & WhatsApp Alerts",
  description:
    "Follow your favourite races and riders. Get predictions, results and race intel for every WorldTour race — delivered straight to your WhatsApp.",
  metadataBase: new URL("https://procyclingpredictor.com"),
  openGraph: {
    title: "Pro Cycling Predictor — AI Race Predictions & WhatsApp Alerts",
    description:
      "Follow your favourite races and riders. Get predictions, results and race intel for every WorldTour race.",
    type: "website",
    url: "https://procyclingpredictor.com",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Pro Cycling Predictor — AI race predictions",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pro Cycling Predictor — AI Race Predictions & WhatsApp Alerts",
    description:
      "Follow your favourite races and riders. Get predictions, results and race intel for every WorldTour race.",
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
