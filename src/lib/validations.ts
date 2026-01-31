/**
 * Zod Validation Schemas
 *
 * Input validation for API routes using Zod
 */

import { z } from "zod";

// ============================================================================
// RACE SCHEMAS
// ============================================================================

export const createRaceSchema = z.object({
  name: z
    .string()
    .min(1, "Race name is required")
    .max(255, "Race name too long"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  discipline: z.enum(["road", "mtb_xco", "mtb_xcc"]),
  raceType: z.enum(["one_day", "stage_race", "xco", "xcc"]).optional(),
  profileType: z.enum(["flat", "hilly", "mountain", "tt", "cobbles"]).optional(),
  ageCategory: z.enum(["elite", "u23", "junior", "masters"]).default("elite"),
  gender: z.enum(["men", "women"]).default("men"),
  distanceKm: z.coerce.number().positive().optional(),
  elevationM: z.coerce.number().nonnegative().optional(),
  uciCategory: z.string().max(50).optional(),
  country: z
    .string()
    .length(3, "Country code must be 3 characters")
    .toUpperCase()
    .optional(),
  startlistUrl: z.string().url("Invalid startlist URL").optional(),
  pcsUrl: z.string().url("Invalid PCS URL").optional(),
});

export const parseStartlistSchema = z.object({
  url: z.string().url("Invalid URL"),
});

// ============================================================================
// RIDER SCHEMAS
// ============================================================================

export const createRiderSchema = z.object({
  name: z
    .string()
    .min(1, "Rider name is required")
    .max(255, "Rider name too long"),
  nationality: z
    .string()
    .length(3, "Nationality must be 3-letter code")
    .toUpperCase()
    .optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional(),
  pcsId: z.string().max(255).optional(),
  uciId: z.string().max(255).optional(),
  xcoId: z.string().max(255).optional(),
});

export const searchRidersSchema = z.object({
  q: z.string().min(1).max(100).optional(),
  discipline: z.enum(["road", "mtb_xco", "mtb_xcc"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// ============================================================================
// TIP SCHEMAS
// ============================================================================

export const submitTipSchema = z.object({
  riderId: z.string().uuid("Invalid rider ID"),
  raceId: z.string().uuid("Invalid race ID").optional(),
  tipText: z
    .string()
    .min(10, "Tip must be at least 10 characters")
    .max(1000, "Tip must be less than 1000 characters"),
  tipType: z
    .enum(["injury", "form", "motivation", "team_dynamics", "equipment", "other"])
    .optional(),
});

// ============================================================================
// PREDICTION SCHEMAS
// ============================================================================

export const getPredictionsSchema = z.object({
  raceId: z.string().uuid("Invalid race ID"),
  limit: z.coerce.number().min(1).max(200).default(50),
});

// ============================================================================
// CHAT SCHEMAS
// ============================================================================

export const chatMessageSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(2000, "Message too long"),
  raceId: z.string().uuid("Invalid race ID").optional(),
  riderId: z.string().uuid("Invalid rider ID").optional(),
  sessionId: z.string().uuid("Invalid session ID").optional(),
});

// ============================================================================
// DISCUSSION SCHEMAS
// ============================================================================

export const createThreadSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(300, "Title too long"),
  raceId: z.string().uuid().optional(),
  riderId: z.string().uuid().optional(),
});

export const createPostSchema = z.object({
  threadId: z.string().uuid("Invalid thread ID"),
  content: z
    .string()
    .min(1, "Post cannot be empty")
    .max(5000, "Post too long"),
  parentPostId: z.string().uuid().optional(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate request body with a Zod schema
 */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<{ data: z.infer<T>; error: null } | { data: null; error: Response }> {
  try {
    const body = await request.json();
    const data = schema.parse(body);
    return { data, error: null };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        data: null,
        error: Response.json(
          {
            error: "Validation failed",
            details: err.issues.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
          { status: 400 }
        ),
      };
    }
    return {
      data: null,
      error: Response.json({ error: "Invalid request body" }, { status: 400 }),
    };
  }
}

/**
 * Validate query parameters with a Zod schema
 */
export function validateQuery<T extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: T
): { data: z.infer<T>; error: null } | { data: null; error: Response } {
  try {
    const params = Object.fromEntries(searchParams.entries());
    const data = schema.parse(params);
    return { data, error: null };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        data: null,
        error: Response.json(
          {
            error: "Validation failed",
            details: err.issues.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
          { status: 400 }
        ),
      };
    }
    return {
      data: null,
      error: Response.json({ error: "Invalid query parameters" }, { status: 400 }),
    };
  }
}
