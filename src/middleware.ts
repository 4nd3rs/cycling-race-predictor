import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  "/",
  "/races(.*)",
  "/riders(.*)",
  "/api/races(.*)",
  "/api/riders(.*)",
  "/api/predictions(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/cron(.*)", // Cron jobs are protected by Vercel's signature
]);

// Define admin-only routes
const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

// Define premium-only routes
const isPremiumRoute = createRouteMatcher(["/api/chat(.*)", "/chat(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims } = await auth();

  // Add security headers to all responses
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Public routes are accessible to everyone
  if (isPublicRoute(req)) {
    return response;
  }

  // Non-public routes require authentication
  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.url);
    return NextResponse.redirect(signInUrl);
  }

  // Admin routes require admin role
  if (isAdminRoute(req)) {
    const metadata = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
    const role = metadata?.role as string | undefined;
    if (role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Premium routes require premium tier
  if (isPremiumRoute(req)) {
    const metadata = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
    const tier = metadata?.tier as string | undefined;
    if (tier !== "premium" && tier !== "admin") {
      return NextResponse.json(
        { error: "Premium subscription required" },
        { status: 403 }
      );
    }
  }

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
