import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from external sources
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.procyclingstats.com",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },

  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Redirect procyclingpredictions.com → procyclingpredictor.com
  async redirects() {
      return [
        { source: "/profile", destination: "/my-race-hub?tab=following", permanent: true },
        { source: "/my-schedule", destination: "/my-race-hub?tab=schedule", permanent: true },
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: "procyclingpredictions.com" }],
        destination: "https://procyclingpredictor.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: "www.procyclingpredictions.com" }],
        destination: "https://procyclingpredictor.com/:path*",
        permanent: true,
      },
    ];
  },

  // Headers for security
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
