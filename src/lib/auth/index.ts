import { auth, currentUser } from "@clerk/nextjs/server";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "a@andmag.se";

export type UserRole = "admin" | "premium" | "free";

export interface AuthUser {
  id: string;
  clerkId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  tier: string;
  role: UserRole;
}

/**
 * Get the current authenticated user from the database.
 * Creates the user record if it doesn't exist.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  // Check if user exists in our database
  let [user] = await db.select().from(users).where(eq(users.clerkId, userId));

  // If user doesn't exist, create them
  if (!user) {
    const clerkUser = await currentUser();
    if (!clerkUser) {
      return null;
    }

    const [newUser] = await db
      .insert(users)
      .values({
        clerkId: userId,
        email: clerkUser.emailAddresses[0]?.emailAddress || null,
        name: `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() || null,
        avatarUrl: clerkUser.imageUrl || null,
        tier: (clerkUser.publicMetadata?.tier as string) || "free",
      })
      .returning();

    user = newUser;
  }

  // Determine role from Clerk metadata
  const clerkUser = await currentUser();
  const role = (clerkUser?.publicMetadata?.role as UserRole) || "free";

  return {
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    tier: user.tier || "free",
    role,
  };
}

/**
 * Lightweight admin check for server components (no DB call).
 */
export async function isAdmin(): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  return user.emailAddresses.some((e) => e.emailAddress === ADMIN_EMAIL);
}

/**
 * Require authentication for an API route.
 * Returns the user or throws a Response with 401 status.
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser();

  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return user;
}

/**
 * Require admin role for an API route.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireAuth();

  if (user.role !== "admin") {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return user;
}

/**
 * Require premium tier for an API route.
 */
export async function requirePremium(): Promise<AuthUser> {
  const user = await requireAuth();

  if (user.tier !== "premium" && user.role !== "admin") {
    throw new Response(
      JSON.stringify({ error: "Premium subscription required" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return user;
}
