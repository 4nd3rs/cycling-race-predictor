import type { RaceProfile } from "./race-profiles";

export interface WeatherAnalysis {
  summary: string;
  alerts: string[];
  severity: "normal" | "moderate" | "extreme";
}

export function analyzeRaceWeather(
  weather: { tempMax: number; tempMin: number; precipMm: number; windKmh: number; weatherCode: number },
  profile: RaceProfile | null,
  intelHeadlines: string[]
): WeatherAnalysis {
  const alerts: string[] = [];
  const { tempMax, tempMin, precipMm, windKmh } = weather;
  const isWet = precipMm > 0.5;
  const isCobbles = profile && (profile.cobbleSectors && profile.cobbleSectors > 0);
  const isGravel = profile?.surface?.toLowerCase().includes("gravel");
  const isMtb = profile?.profileType?.startsWith("mtb");
  const isExposedRace = profile && (profile.profileType === "classics" || profile.profileType === "flat");

  // Temperature
  if (tempMax < 3) {
    alerts.push(`Near-freezing — ${tempMax}°C max. Mechanical issues likely, expect extreme caution on descents`);
  } else if (tempMax < 8 && isWet) {
    alerts.push(`Cold and wet (${tempMax}°C / ${precipMm}mm) — hardman conditions, tactics may be conservative early`);
  } else if (tempMax > 34) {
    alerts.push(`Extreme heat — ${tempMax}°C. Hydration battles expected, attacks in shaded or downhill sections`);
  } else if (tempMax > 30) {
    alerts.push(`Hot racing — ${tempMax}°C. Teams will need extra feed zone support`);
  }

  // Wind
  if (windKmh > 45) {
    alerts.push(`Dangerous wind — ${windKmh} km/h. Echelons and crosswind splits almost certain on exposed roads`);
  } else if (windKmh > 30 && isExposedRace) {
    alerts.push(`Strong crosswind (${windKmh} km/h) on exposed roads — peloton splits and gutter riding expected`);
  } else if (windKmh > 25) {
    alerts.push(`Significant wind (${windKmh} km/h) — may affect exposed sectors`);
  }

  // Rain on specific surfaces
  if (isWet && isCobbles) {
    alerts.push(`Wet pavé — slippery cobbles dramatically increase crash risk and difficulty`);
  } else if (isWet && isGravel) {
    alerts.push(`Wet gravel (${precipMm}mm) — loose and slippery strade bianche, expect punctures and big attacks`);
  } else if (isWet && isMtb) {
    alerts.push(`${precipMm}mm rain — muddy/slippery track. Bike handling and tire choice critical`);
  } else if (precipMm > 8) {
    alerts.push(`Heavy rain (${precipMm}mm) — wet roads throughout, reduced braking and grip`);
  } else if (isWet) {
    alerts.push(`Light rain (${precipMm}mm) forecast — roads will be slick, especially on corners`);
  }

  // Intel cross-reference
  const intelText = intelHeadlines.join(" ").toLowerCase();
  if (intelText.match(/crash|injur|sick|ill|dns|withdraw|abandon|out of|doubt/)) {
    alerts.push(`Recent intel flags possible startlist changes — check latest news`);
  }

  // Summary sentence
  let summary: string;
  const conditionCount = alerts.length;

  if (conditionCount === 0) {
    if (tempMax >= 14 && tempMax <= 24 && precipMm < 0.5 && windKmh < 20) {
      summary = `Good racing conditions — ${tempMax}°C and dry with light winds.`;
    } else {
      summary = `${tempMax}°C, ${precipMm}mm rain, ${windKmh} km/h wind — manageable conditions.`;
    }
  } else if (isCobbles && isWet) {
    summary = `Wet cobbles and ${tempMax}°C will make this a brutal, attrition-based edition.`;
  } else if (isGravel && isWet) {
    summary = `Rain on the strade bianche — expect a chaotic, selective race with the gravel turning to mud.`;
  } else if (windKmh > 40) {
    summary = `${windKmh} km/h winds will split this race to pieces before the final climbs.`;
  } else if (tempMax < 5) {
    summary = `Freezing conditions at ${tempMax}°C will test riders' resolve and equipment reliability.`;
  } else if (tempMax > 33) {
    summary = `${tempMax}°C heat turns this into a race against attrition as much as opponents.`;
  } else {
    summary = `${tempMax}°C with ${precipMm > 0 ? `${precipMm}mm rain` : "dry roads"} and ${windKmh} km/h winds — ${conditionCount > 1 ? "challenging" : "notable"} conditions expected.`;
  }

  const severity: WeatherAnalysis["severity"] =
    conditionCount >= 2 ? "extreme" : conditionCount === 1 ? "moderate" : "normal";

  return { summary, alerts, severity };
}
