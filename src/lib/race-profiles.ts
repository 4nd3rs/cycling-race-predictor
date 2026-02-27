export interface Climb {
  name: string;
  altitudeM: number;
  gradientPct?: number;
  lengthKm?: number;
}

export interface RaceProfile {
  distanceKm?: number;
  distanceWomenKm?: number;
  elevationGainM?: number;
  profileType: "flat" | "hilly" | "mountainous" | "classics" | "gravel" | "mtb-xco" | "mtb-marathon";
  surface: string;
  keyFeatures: string[];
  raceCharacter: string;
  keyClimbs?: Climb[];
  cobbleSectors?: number;
  firstEdition?: number;
  pastWinners?: { year: number; name: string; team?: string }[];
}

// ── Match helper ─────────────────────────────────────────────────────────────
export function getRaceProfile(slug: string, name: string): RaceProfile | null {
  const s = slug.toLowerCase();
  const n = name.toLowerCase();
  const has = (...kw: string[]) => kw.some(k => s.includes(k) || n.includes(k));

  if (has("omloop", "nieuwsblad")) return OMLOOP;
  if (has("strade-bianche", "strade bianche")) return STRADE_BIANCHE;
  if (has("sanremo", "san-remo", "milan-san", "milano-san")) return MILAN_SANREMO;
  if (has("ronde", "vlaanderen", "tour-of-flanders")) return TOUR_OF_FLANDERS;
  if (has("roubaix")) return PARIS_ROUBAIX;
  if (has("amstel")) return AMSTEL_GOLD;
  if (has("fleche", "flèche", "wallonne")) return LA_FLECHE_WALLONNE;
  if (has("liege", "liège", "bastogne")) return LBL;
  if (has("lombardia", "lombardy", "il-lombardia")) return IL_LOMBARDIA;
  if (has("paris-nice", "paris nice")) return PARIS_NICE;
  if (has("tirreno")) return TIRRENO_ADRIATICO;
  if (has("dauphine", "dauphiné")) return CRITERIUM_DU_DAUPHINE;
  if (has("tour-de-suisse", "suisse")) return TOUR_DE_SUISSE;
  if (has("dwars-door", "dwars door")) return DWARS_DOOR_VLAANDEREN;
  if (has("gent-wevelgem", "gent wevelgem")) return GENT_WEVELGEM;
  if (has("e3-saxo", "e3 saxo", "e3-harelbeke")) return E3_SAXO;
  if (has("giro-d-italia", "giro d'italia", "giro-ditalia")) return GIRO_DITALIA;
  if (has("tour-de-france", "tour de france")) return TOUR_DE_FRANCE;
  if (has("vuelta")) return VUELTA;
  if (has("val-di-sole", "val di sole")) return VAL_DI_SOLE;
  if (has("leogang")) return LEOGANG;
  if (has("les-gets", "les gets")) return LES_GETS;
  if (has("lenzerheide")) return LENZERHEIDE;
  if (has("mont-sainte-anne", "mont sainte")) return MONT_SAINTE_ANNE;
  if (has("snowshoe")) return SNOWSHOE;
  return null;
}

// ── SPRING CLASSICS ──────────────────────────────────────────────────────────

const OMLOOP: RaceProfile = {
  distanceKm: 207,
  distanceWomenKm: 135,
  elevationGainM: 2500,
  profileType: "classics",
  surface: "Road (cobbles + kermesse roads)",
  keyFeatures: ["17 difficult climbs", "Muur van Geraardsbergen (148m, 19.8%)", "Bosberg (110m, 10%)", "Wijnpers climb", "Technical descent after Muur"],
  keyClimbs: [
    { name: "Muur van Geraardsbergen", altitudeM: 148, gradientPct: 19.8, lengthKm: 1.1 },
    { name: "Bosberg", altitudeM: 110, gradientPct: 10, lengthKm: 1.4 },
    { name: "Wijnpers", altitudeM: 90, gradientPct: 14 },
  ],
  raceCharacter: "The traditional season opener for Belgian classics. A relentlessly punchy course through the Flemish Ardennes rewards attackers — the Muur with 12km to go is the decisive moment. Often animated by crosswind echelons on the open roads early on.",
  firstEdition: 1945,
  pastWinners: [
    { year: 2025, name: "Søren Wærenskjold", team: "Uno-X Mobility" },
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Wout van Aert", team: "Jumbo-Visma" },
    { year: 2022, name: "Christophe Laporte", team: "Jumbo-Visma" },
    { year: 2021, name: "Davide Ballerini", team: "Deceuninck-QuickStep" },
  ],
};

const STRADE_BIANCHE: RaceProfile = {
  distanceKm: 184,
  distanceWomenKm: 137,
  elevationGainM: 3400,
  profileType: "gravel",
  surface: "Mixed: paved road + white gravel roads (strade bianche)",
  keyFeatures: ["11 gravel sectors (63km total)", "Sector 8 Monte Sante Marie (11.5km)", "Final climb via Via Santa Caterina to Siena", "Tuscan hills with loose white gravel"],
  raceCharacter: "Unique gravel classic through Tuscan countryside. The white roads eliminate any predictable race pattern — long attrition battles are common. The final 3km cobbled climb into Piazza del Campo in Siena is one of the most dramatic finishes in cycling.",
  firstEdition: 2007,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2022, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2021, name: "Egan Bernal", team: "Ineos Grenadiers" },
  ],
};

const MILAN_SANREMO: RaceProfile = {
  distanceKm: 295,
  elevationGainM: 3500,
  profileType: "hilly",
  surface: "Road",
  keyFeatures: ["Longest classic in the world", "Cipressa climb (5.6km, 4.1%)", "Poggio di San Remo (3.7km, 3.7%)", "Fast descent to flat sprint or breakaway finish"],
  keyClimbs: [
    { name: "Cipressa", altitudeM: 240, gradientPct: 4.1, lengthKm: 5.6 },
    { name: "Poggio di San Remo", altitudeM: 162, gradientPct: 3.7, lengthKm: 3.7 },
  ],
  raceCharacter: "La Classicissima — the longest one-day race. The early Ligurian climbs (Turchino, Capo Mele, Capo Cervo, Capo Berta) soften the legs before the Cipressa and decisive Poggio. Most editions end in a sprint but the fastest descenders can solo off the Poggio.",
  firstEdition: 1907,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Jasper Philipsen", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2022, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2021, name: "Jasper Stuyven", team: "Trek-Segafredo" },
  ],
};

const TOUR_OF_FLANDERS: RaceProfile = {
  distanceKm: 273,
  distanceWomenKm: 163,
  elevationGainM: 2700,
  profileType: "classics",
  surface: "Road + cobbled climbs and sectors",
  cobbleSectors: 7,
  keyFeatures: ["18 steep climbs", "Oude Kwaremont (2.2km, 4% avg / 11% max)", "Paterberg (360m, 12.9% avg)", "Final double-ascent of Kwaremont + Paterberg", "7 cobble sectors"],
  keyClimbs: [
    { name: "Oude Kwaremont", altitudeM: 108, gradientPct: 4, lengthKm: 2.2 },
    { name: "Paterberg", altitudeM: 68, gradientPct: 12.9, lengthKm: 0.4 },
    { name: "Wijnberg", altitudeM: 75, gradientPct: 7 },
  ],
  raceCharacter: "The Flemish Monument. A war of attrition decided by the brutal final double-ascent of the Kwaremont and Paterberg with ~15km to go. Whoever survives that can solo to Oudenaarde. Suited to powerful punchy classics riders who can also climb.",
  firstEdition: 1913,
  pastWinners: [
    { year: 2025, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2022, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2021, name: "Kasper Asgreen", team: "Deceuninck-QuickStep" },
  ],
};

const PARIS_ROUBAIX: RaceProfile = {
  distanceKm: 257,
  distanceWomenKm: 145,
  elevationGainM: 1600,
  profileType: "classics",
  surface: "Road + cobblestones (pavé)",
  cobbleSectors: 29,
  keyFeatures: ["29 cobble sectors (55km total)", "Carrefour de l'Arbre (5 stars, 2.1km)", "Trouée d'Arenberg (5 stars, 2.3km)", "Forest of Arenberg danger zone", "Velodrome finish in Roubaix"],
  raceCharacter: "Hell of the North. The hardest cobbled race in the world — 29 sectors of medieval pavé where bike handling, power, and luck all matter equally. The Arenberg trench (5-star sector) at 100km to go sets the selection; the Carrefour de l'Arbre with 17km left decides the winner.",
  firstEdition: 1896,
  pastWinners: [
    { year: 2025, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2022, name: "Dylan van Baarle", team: "Ineos Grenadiers" },
    { year: 2021, name: "Sonny Colbrelli", team: "Bahrain Victorious" },
  ],
};

const AMSTEL_GOLD: RaceProfile = {
  distanceKm: 263,
  distanceWomenKm: 160,
  elevationGainM: 4000,
  profileType: "hilly",
  surface: "Road",
  keyFeatures: ["More than 30 short steep hills", "Cauberg (600m, 8.5%)", "Bemelerberg and Fromberg climbs", "Sprint-like finale from Valkenburg"],
  raceCharacter: "Dutch monument through the rolling Limburg hills. The sheer volume of climbing (30+ hills) grinds the field down; the explosive Cauberg and Bemelerberg separate the strong. Often ends in a small-group sprint — pure classics riders prevail.",
  firstEdition: 1966,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2022, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2021, name: "Tom Pidcock", team: "Ineos Grenadiers" },
  ],
};

const LA_FLECHE_WALLONNE: RaceProfile = {
  distanceKm: 202,
  distanceWomenKm: 130,
  elevationGainM: 4100,
  profileType: "hilly",
  surface: "Road",
  keyFeatures: ["Mur de Huy climbed 3 times (1.3km, 9.6% avg / 26% max)", "Third and final ascent is the decisive finish", "Pure puncheur race"],
  keyClimbs: [
    { name: "Mur de Huy", altitudeM: 204, gradientPct: 9.6, lengthKm: 1.3 },
  ],
  raceCharacter: "The Arrow of Wallonia — one of the most predictable classics. The Mur de Huy wall (26% max gradient!) is climbed three times; the final ascent is the finish line. An explosive, diesel-free day: only the best uphill sprinters and puncheurs win here.",
  firstEdition: 1936,
  pastWinners: [
    { year: 2025, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2024, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2023, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2022, name: "Julian Alaphilippe", team: "QuickStep Alpha Vinyl" },
    { year: 2021, name: "Alejandro Valverde", team: "Movistar" },
  ],
};

const LBL: RaceProfile = {
  distanceKm: 261,
  distanceWomenKm: 157,
  elevationGainM: 4600,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["La Doyenne — oldest Monument (since 1892)", "Côte de La Redoute (2km, 8.9%)", "Côte des Forges (1.7km, 6.8%)", "Côte de la Roche aux Faucons (1.9km, 9.8%)", "Côte de Saint-Nicolas finale"],
  keyClimbs: [
    { name: "La Redoute", altitudeM: 300, gradientPct: 8.9, lengthKm: 2 },
    { name: "Roche aux Faucons", altitudeM: 340, gradientPct: 9.8, lengthKm: 1.9 },
    { name: "Côte de Saint-Nicolas", altitudeM: 255, gradientPct: 9.4, lengthKm: 1.2 },
  ],
  raceCharacter: "The Grand Old Lady. The longest and most demanding Monument features persistent Ardennes climbing. La Redoute at 60km to go begins the real selection; the Roche aux Faucons with 22km left is the launch pad. Best climber-classics riders dominate.",
  firstEdition: 1892,
  pastWinners: [
    { year: 2025, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2022, name: "Remco Evenepoel", team: "QuickStep Alpha Vinyl" },
    { year: 2021, name: "Tadej Pogačar", team: "UAE Team Emirates" },
  ],
};

const IL_LOMBARDIA: RaceProfile = {
  distanceKm: 253,
  elevationGainM: 5000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["Race of the Falling Leaves", "Civiglio (6.2km, 9.7%)", "Madonna del Ghisallo (8.6km, 6.2%)", "Colma di Sormano or Civiglio before the finale", "San Fermo della Battaglia final descent"],
  keyClimbs: [
    { name: "Madonna del Ghisallo", altitudeM: 754, gradientPct: 6.2, lengthKm: 8.6 },
    { name: "Civiglio", altitudeM: 580, gradientPct: 9.7, lengthKm: 6.2 },
    { name: "San Fermo della Battaglia", altitudeM: 410, gradientPct: 11, lengthKm: 1.6 },
  ],
  raceCharacter: "The autumn classic among the lakes. Five thousand metres of climbing through the Italian lakes district makes this a pure climbers' race. The Madonna del Ghisallo chapel marks the spiritual heart; the final descent into Como or Bergamo demands bike handling and nerve.",
  firstEdition: 1905,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2022, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2021, name: "Tadej Pogačar", team: "UAE Team Emirates" },
  ],
};

const PARIS_NICE: RaceProfile = {
  distanceKm: 1200,
  elevationGainM: 15000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["8-stage race", "\"Race to the Sun\"", "Stages 4–8 in Alps and Côte d'Azur", "Col de la Couillole and Turini climbs", "Final ITT or summit finish"],
  raceCharacter: "The Race to the Sun bridges winter and the classics season. The first half favors sprint teams and baroudeurs; the final Alpine stages reward the overall contenders. GC often decided on Stages 6 or 7 with a mountain finish.",
  firstEdition: 1933,
  pastWinners: [
    { year: 2025, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2024, name: "Joao Almeida", team: "UAE Team Emirates" },
    { year: 2023, name: "Carlos Rodriguez", team: "Ineos Grenadiers" },
    { year: 2022, name: "Maximilian Schachmann", team: "Bora-Hansgrohe" },
    { year: 2021, name: "Maximilian Schachmann", team: "Bora-Hansgrohe" },
  ],
};

const TIRRENO_ADRIATICO: RaceProfile = {
  distanceKm: 1100,
  elevationGainM: 13000,
  profileType: "hilly",
  surface: "Road",
  keyFeatures: ["7-stage race", "Tyrrhenian Sea to Adriatic Sea", "Summit finishes on Prati di Tivo, Sassotetto", "Final ITT on the Adriatic coast", "Baroudeur-friendly early stages"],
  raceCharacter: "The Race of the Two Seas. A punchy week across the Italian peninsula with stages suited to both sprinters and climbers. The mountain stages reward complete GC riders; the coastal ITT is often the decider.",
  firstEdition: 1966,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2022, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2021, name: "Filippo Ganna", team: "Ineos Grenadiers" },
  ],
};

const CRITERIUM_DU_DAUPHINE: RaceProfile = {
  distanceKm: 1000,
  elevationGainM: 20000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["8-stage race", "Key Tour de France rehearsal", "Mont Ventoux, Col de la Croix de Fer", "High-altitude summit finishes", "Often decisive for Tour form"],
  raceCharacter: "The ultimate Tour de France dress rehearsal. Eight days through the French Alps with summit finishes that mirror the Tour's hardest days. GC contenders use this to test their climbing form; the winner is almost always a Tour favourite.",
  firstEdition: 1947,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Carlos Rodriguez", team: "Ineos Grenadiers" },
    { year: 2023, name: "Tao Geoghegan Hart", team: "Ineos Grenadiers" },
    { year: 2022, name: "Geraint Thomas", team: "Ineos Grenadiers" },
    { year: 2021, name: "Richie Porte", team: "Ineos Grenadiers" },
  ],
};

const TOUR_DE_SUISSE: RaceProfile = {
  distanceKm: 1100,
  elevationGainM: 17000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["8-stage race", "Swiss Alps: Gotthard, Furka, Susten passes", "Multiple ITTs", "Final summit finish tradition"],
  raceCharacter: "One of the most prestigious pre-Tour stage races. The Swiss Alps provide spectacular and brutal terrain. The final weekend summit finishes are decisive; the time trial tests completeness.",
  firstEdition: 1933,
  pastWinners: [
    { year: 2025, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2024, name: "Remco Evenepoel", team: "Soudal QuickStep" },
    { year: 2023, name: "Geraint Thomas", team: "Ineos Grenadiers" },
    { year: 2022, name: "Geraint Thomas", team: "Ineos Grenadiers" },
    { year: 2021, name: "Richard Carapaz", team: "Ineos Grenadiers" },
  ],
};

const DWARS_DOOR_VLAANDEREN: RaceProfile = {
  distanceKm: 184,
  elevationGainM: 1900,
  profileType: "classics",
  surface: "Road + cobbles",
  keyFeatures: ["Flemish mini-classic day before E3", "Kortekeer, Taaienberg, Varent climbs", "Fast rolling finale", "Springboard for Ronde week"],
  raceCharacter: "The Wednesday classic that opens Flemish week. Shorter and faster than Ronde, it suits the pure classics riders over the climbers. Used by teams to test form before the weekend's bigger objectives.",
  firstEdition: 1945,
  pastWinners: [
    { year: 2025, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Wout van Aert", team: "Jumbo-Visma" },
    { year: 2022, name: "Christophe Laporte", team: "Jumbo-Visma" },
    { year: 2021, name: "Kasper Asgreen", team: "Deceuninck-QuickStep" },
  ],
};

const GENT_WEVELGEM: RaceProfile = {
  distanceKm: 254,
  distanceWomenKm: 162,
  elevationGainM: 2100,
  profileType: "classics",
  surface: "Road",
  keyFeatures: ["Double ascent of Kemmelberg (km 118 + km 145)", "Exposed crosswind sectors near coast", "Fast sprinter-friendly finale if no break", "Kemmelberg (500m, 12% max)"],
  keyClimbs: [
    { name: "Kemmelberg", altitudeM: 156, gradientPct: 12, lengthKm: 0.5 },
  ],
  raceCharacter: "In the Shadows of WWI battlefields. Coastal crosswinds in the first 100km can shatter the peloton; the Kemmelberg is the real selector. If a sprinter survives the climbs, Wevelgem often ends in a bunch sprint — but the wind makes it unpredictable.",
  firstEdition: 1934,
  pastWinners: [
    { year: 2025, name: "Jasper Philipsen", team: "Alpecin-Deceuninck" },
    { year: 2024, name: "Mads Pedersen", team: "Lidl-Trek" },
    { year: 2023, name: "Christophe Laporte", team: "Jumbo-Visma" },
    { year: 2022, name: "Biniam Girmay", team: "Intermarché" },
    { year: 2021, name: "Wout van Aert", team: "Jumbo-Visma" },
  ],
};

const E3_SAXO: RaceProfile = {
  distanceKm: 204,
  elevationGainM: 2500,
  profileType: "classics",
  surface: "Road + cobbles",
  keyFeatures: ["Taaienberg, Kortekeer, Karnemelkbeek climbs", "Wolvenberg (600m, 9.4%)", "Double Paterberg ascent", "8 climbs in final 70km"],
  raceCharacter: "The Ronde preview — often called a mini-Tour of Flanders. The route is brutal in the final 70km with repeated short, steep ascents. Whoever wins here is the Ronde favourite. Pure power-climbers dominate.",
  firstEdition: 1958,
  pastWinners: [
    { year: 2025, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2023, name: "Wout van Aert", team: "Jumbo-Visma" },
    { year: 2022, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
    { year: 2021, name: "Kasper Asgreen", team: "Deceuninck-QuickStep" },
  ],
};

// ── GRAND TOURS ───────────────────────────────────────────────────────────────

const GIRO_DITALIA: RaceProfile = {
  distanceKm: 3400,
  elevationGainM: 50000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["21 stages", "Highest GT: Stelvio, Gavia, Mortirolo", "Pink jersey (Maglia Rosa)", "Time trials and mountain stages", "Often decisive in the final week"],
  raceCharacter: "The most scenic and unpredictable Grand Tour. Italian roads are narrower and more technical; the cold mountain stages can arrive suddenly. The race often comes alive in the second week with dramatic high-altitude battles.",
  firstEdition: 1909,
  pastWinners: [
    { year: 2025, name: "Primož Roglič", team: "Red Bull-Bora-Hansgrohe" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Primož Roglič", team: "Jumbo-Visma" },
    { year: 2022, name: "Jai Hindley", team: "Bora-Hansgrohe" },
    { year: 2021, name: "Egan Bernal", team: "Ineos Grenadiers" },
  ],
};

const TOUR_DE_FRANCE: RaceProfile = {
  distanceKm: 3400,
  elevationGainM: 50000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["21 stages", "Yellow jersey (Maillot Jaune)", "Alpe d'Huez, Col du Tourmalet, Ventoux", "Team time trial, mountain ITT", "Champs-Élysées finale"],
  raceCharacter: "The biggest race in the world. Three weeks of relentless competition: sprint stages, mountain passes, and time trials. GC contenders must survive 50,000m of climbing and stay out of trouble in nervous bunch stages.",
  firstEdition: 1903,
  pastWinners: [
    { year: 2025, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2024, name: "Tadej Pogačar", team: "UAE Team Emirates" },
    { year: 2023, name: "Jonas Vingegaard", team: "Jumbo-Visma" },
    { year: 2022, name: "Jonas Vingegaard", team: "Jumbo-Visma" },
    { year: 2021, name: "Tadej Pogačar", team: "UAE Team Emirates" },
  ],
};

const VUELTA: RaceProfile = {
  distanceKm: 3200,
  elevationGainM: 48000,
  profileType: "mountainous",
  surface: "Road",
  keyFeatures: ["21 stages", "Red jersey (Maillot Rojo)", "Angliru, Lagos de Covadonga, La Covatilla", "Most vertical gain of any Grand Tour", "Often won by a GC dark horse"],
  raceCharacter: "The Spanish Grand Tour is the hardest three weeks for climbers. The Vuelta serves up the most brutal climbs of any GT — the Angliru at 24% gradient is the most feared. Late summer racing often reveals new talent.",
  firstEdition: 1935,
  pastWinners: [
    { year: 2025, name: "Primož Roglič", team: "Red Bull-Bora-Hansgrohe" },
    { year: 2024, name: "Ben O'Connor", team: "Decathlon AG2R" },
    { year: 2023, name: "Sepp Kuss", team: "Jumbo-Visma" },
    { year: 2022, name: "Remco Evenepoel", team: "QuickStep Alpha Vinyl" },
    { year: 2021, name: "Primož Roglič", team: "Jumbo-Visma" },
  ],
};

// ── MTB WORLD CUP VENUES ──────────────────────────────────────────────────────

const VAL_DI_SOLE: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Rocky alpine singletrack",
  keyFeatures: ["One of the most technical XCO tracks", "Long rock gardens", "High altitude (1500m)", "Famous Big Rock descent", "World Cup and World Championship venue"],
  raceCharacter: "The Italian Dolomites venue is considered the hardest XCO track on the World Cup circuit. The Big Rock technical section at the top of each lap separates top riders from the rest. High altitude adds another challenge.",
  pastWinners: [
    { year: 2024, name: "Tom Pidcock", team: "Ineos Grenadiers" },
    { year: 2023, name: "Tom Pidcock", team: "Ineos Grenadiers" },
    { year: 2022, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
  ],
};

const LEOGANG: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Mixed alpine terrain",
  keyFeatures: ["Austrian Salzburg Alps venue", "Big mountain vista start loop", "Multiple rooted singletrack sections", "Used for World Championships"],
  raceCharacter: "Leogang's XCO course combines a spectacular alpine start with technical lower sections through the trees. The long course suits diesel riders who can maintain pace across multiple laps.",
};

const LES_GETS: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Alpine singletrack",
  keyFeatures: ["French Alps resort venue", "Long climb on each lap", "Technical descent with multiple line choices", "World Championships hosted here"],
  raceCharacter: "Les Gets rewards explosive climbers. The steep start loop repeats on each lap, making it a relentless test of power-to-weight. The technical descent offers overtaking opportunities for skilled bike handlers.",
};

const LENZERHEIDE: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Alpine singletrack",
  keyFeatures: ["Swiss World Championships venue", "High altitude racing (1470m)", "Sustained technical climbing", "Switchback-heavy descent"],
  raceCharacter: "Lenzerheide hosted multiple World Championships and is a prestigious venue. The sustained climbing at altitude makes it one of the fittest-wins courses on the circuit, while the technical descent keeps bike handlers in contention.",
};

const MONT_SAINTE_ANNE: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Rocky/rooted Quebec forest",
  keyFeatures: ["World Cup venue since 1991", "Famous 'la Chaîne' rock section", "Long sustained climbs", "North American classic", "Often wet and muddy"],
  raceCharacter: "The oldest World Cup venue in North America. The Quebec forest offers classic North American XCO — rooty, rocky, often damp. The sustained climbs suit powerhouses; the technical sections can create surprising outcomes.",
  pastWinners: [
    { year: 2024, name: "Mathieu van der Poel", team: "Alpecin-Deceuninck" },
  ],
};

const SNOWSHOE: RaceProfile = {
  profileType: "mtb-xco",
  surface: "Ski resort singletrack",
  keyFeatures: ["West Virginia USA venue", "High elevation ski resort", "Long punchy climbs on ski runs", "Rooted forest singletrack sections"],
  raceCharacter: "Snowshoe is America's home XCO World Cup on a ski resort. The mix of open ski run climbs and forest singletrack tests all-round ability. American and Canadian crowds create a unique atmosphere.",
};
