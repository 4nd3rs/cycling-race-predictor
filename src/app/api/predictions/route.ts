import { NextResponse } from "next/server";
import {
  db,
  predictions,
  riders,
  riderDisciplineStats,
  raceStartlist,
  races,
  riderRumours,
  raceResults,
} from "@/lib/db";
import { withRateLimit } from "@/lib/rate-limit";
import { validateQuery, getPredictionsSchema } from "@/lib/validations";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  generateRacePredictions,
  type RiderPredictionInput,
} from "@/lib/prediction";
import { calculateForm, type RecentResult, RACE_CATEGORY_WEIGHTS } from "@/lib/prediction";
import { type ProfileType } from "@/lib/prediction";

export async function GET(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "prediction");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);

  // Validate query parameters
  const { data, error } = validateQuery(searchParams, getPredictionsSchema);
  if (error) return error;

  try {
    // Get existing predictions
    const existingPredictions = await db
      .select({
        prediction: predictions,
        rider: riders,
      })
      .from(predictions)
      .innerJoin(riders, eq(predictions.riderId, riders.id))
      .where(eq(predictions.raceId, data.raceId))
      .orderBy(desc(predictions.winProbability))
      .limit(data.limit);

    if (existingPredictions.length > 0) {
      return NextResponse.json({
        predictions: existingPredictions.map(({ prediction, rider }) => ({
          riderId: rider.id,
          riderName: rider.name,
          nationality: rider.nationality,
          predictedPosition: prediction.predictedPosition,
          winProbability: parseFloat(prediction.winProbability || "0"),
          podiumProbability: parseFloat(prediction.podiumProbability || "0"),
          top10Probability: parseFloat(prediction.top10Probability || "0"),
          confidence: parseFloat(prediction.confidenceScore || "0.5"),
          reasoning: prediction.reasoning,
          eloScore: parseFloat(prediction.eloScore || "1500"),
          formMultiplier: parseFloat(prediction.formScore || "1"),
          profileMultiplier: parseFloat(prediction.profileAffinityScore || "1"),
          rumourModifier: parseFloat(prediction.rumourModifier || "0"),
        })),
      });
    }

    // No predictions exist - return empty
    return NextResponse.json({ predictions: [] });
  } catch (err) {
    console.error("Error fetching predictions:", err);
    return NextResponse.json(
      { error: "Failed to fetch predictions" },
      { status: 500 }
    );
  }
}

// POST - Generate new predictions for a race
export async function POST(request: Request) {
  // Rate limit
  const rateLimitResponse = await withRateLimit(request, "prediction");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const raceId = body.raceId;

    if (!raceId) {
      return NextResponse.json(
        { error: "raceId is required" },
        { status: 400 }
      );
    }

    // Get race details
    const [race] = await db
      .select()
      .from(races)
      .where(eq(races.id, raceId))
      .limit(1);

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // Get startlist with rider stats
    const startlistEntries = await db
      .select({
        entry: raceStartlist,
        rider: riders,
        stats: riderDisciplineStats,
      })
      .from(raceStartlist)
      .innerJoin(riders, eq(raceStartlist.riderId, riders.id))
      .leftJoin(
        riderDisciplineStats,
        and(
          eq(riderDisciplineStats.riderId, riders.id),
          eq(riderDisciplineStats.discipline, race.discipline)
        )
      )
      .where(eq(raceStartlist.raceId, raceId));

    if (startlistEntries.length === 0) {
      return NextResponse.json(
        { error: "No riders in startlist" },
        { status: 400 }
      );
    }

    // Build prediction inputs
    const predictionInputs: RiderPredictionInput[] = [];

    for (const { rider, stats } of startlistEntries) {
      // Get rider's recent results for form calculation
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const recentResults = await db
        .select({
          result: raceResults,
          race: races,
        })
        .from(raceResults)
        .innerJoin(races, eq(raceResults.raceId, races.id))
        .where(
          and(
            eq(raceResults.riderId, rider.id),
            gte(races.date, ninetyDaysAgo.toISOString().split("T")[0])
          )
        )
        .limit(20);

      // Format for form calculation
      const formResults: RecentResult[] = recentResults.map(({ result, race: r }) => ({
        date: new Date(r.date),
        position: result.position,
        fieldSize: 150, // Estimate
        raceWeight: RACE_CATEGORY_WEIGHTS[r.uciCategory || ""] || 0.5,
        profileType: r.profileType || "hilly",
        dnf: result.dnf || false,
      }));

      const formScore = calculateForm(formResults);

      // Get rumour data
      const [rumour] = await db
        .select()
        .from(riderRumours)
        .where(eq(riderRumours.riderId, rider.id))
        .limit(1);

      // Get profile affinity for race type
      const affinities = (stats?.profileAffinities || {}) as Record<string, number>;
      const raceProfile = race.profileType || "hilly";
      const profileAffinity = affinities[raceProfile] || 0.5;

      predictionInputs.push({
        riderId: rider.id,
        riderName: rider.name,
        eloMean: parseFloat(stats?.eloMean || "1500"),
        eloVariance: parseFloat(stats?.eloVariance || "350") ** 2,
        formScore,
        profileAffinity,
        profileSampleSize: stats?.racesTotal || 0,
        rumourScore: parseFloat(rumour?.aggregateScore || "0"),
        rumourTipCount: rumour?.tipCount || 0,
      });
    }

    // Generate predictions
    const result = generateRacePredictions(
      raceId,
      predictionInputs,
      (race.profileType || "hilly") as ProfileType
    );

    // Delete old predictions
    await db.delete(predictions).where(eq(predictions.raceId, raceId));

    // Insert new predictions
    for (const pred of result.predictions) {
      await db.insert(predictions).values({
        raceId,
        riderId: pred.riderId,
        predictedPosition: pred.predictedPosition,
        winProbability: pred.winProbability.toString(),
        podiumProbability: pred.podiumProbability.toString(),
        top10Probability: pred.top10Probability.toString(),
        confidenceScore: pred.confidence.toString(),
        reasoning: pred.reasoning,
        eloScore: pred.eloScore.toString(),
        formScore: pred.formMultiplier.toString(),
        profileAffinityScore: pred.profileMultiplier.toString(),
        rumourModifier: pred.rumourModifier.toString(),
        version: result.version,
      });
    }

    return NextResponse.json({
      message: "Predictions generated",
      count: result.predictions.length,
      predictions: result.predictions.slice(0, 10),
    });
  } catch (err) {
    console.error("Error generating predictions:", err);
    return NextResponse.json(
      { error: "Failed to generate predictions" },
      { status: 500 }
    );
  }
}
