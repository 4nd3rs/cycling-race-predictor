/**
 * Comprehensive UCI 3-letter code → country name mapping.
 * Includes both UCI codes and common ISO alpha-3 variants that may appear in the database.
 * Used by country filter dropdowns across the app.
 */
const COUNTRY_NAMES: Record<string, string> = {
  // Western Europe
  AND: "Andorra", AUT: "Austria", BEL: "Belgium", CYP: "Cyprus",
  DEN: "Denmark", DNK: "Denmark",
  ESP: "Spain", EST: "Estonia", FIN: "Finland", FRA: "France",
  GBR: "Great Britain", GER: "Germany", DEU: "Germany",
  GRE: "Greece", GRC: "Greece",
  IRL: "Ireland", ISL: "Iceland", ITA: "Italy",
  LAT: "Latvia", LVA: "Latvia",
  LTU: "Lithuania", LUX: "Luxembourg",
  MLT: "Malta", MON: "Monaco",
  NED: "Netherlands", NLD: "Netherlands",
  NOR: "Norway", POL: "Poland",
  POR: "Portugal", PRT: "Portugal",
  SUI: "Switzerland", CHE: "Switzerland",
  SWE: "Sweden",

  // Balkans / Eastern Europe
  BIH: "Bosnia & Herzegovina", BUL: "Bulgaria", BGR: "Bulgaria",
  CRO: "Croatia", HRV: "Croatia",
  CZE: "Czech Republic", HUN: "Hungary",
  KAZ: "Kazakhstan", MDA: "Moldova",
  ROU: "Romania", RUS: "Russia",
  SLO: "Slovenia", SVN: "Slovenia",
  SVK: "Slovakia", SRB: "Serbia",
  TUR: "Turkey", UKR: "Ukraine",
  BLR: "Belarus", GEO: "Georgia",
  MKD: "North Macedonia", MNE: "Montenegro",
  ALB: "Albania", ARM: "Armenia", AZE: "Azerbaijan",
  UZB: "Uzbekistan",

  // Americas
  ARG: "Argentina", BER: "Bermuda", BOL: "Bolivia",
  BRA: "Brazil", CAN: "Canada",
  CHI: "Chile", CHL: "Chile",
  COL: "Colombia", CRC: "Costa Rica", CRI: "Costa Rica",
  CUB: "Cuba", DOM: "Dominican Republic",
  ECU: "Ecuador", ESA: "El Salvador",
  GUA: "Guatemala", GTM: "Guatemala",
  GUM: "Guam", HON: "Honduras",
  JAM: "Jamaica", MEX: "Mexico",
  NCA: "Nicaragua",
  PAN: "Panama", PAR: "Paraguay", PRY: "Paraguay",
  PER: "Peru", PUR: "Puerto Rico", PRI: "Puerto Rico",
  TTO: "Trinidad & Tobago", URU: "Uruguay", URY: "Uruguay",
  USA: "United States", VEN: "Venezuela",

  // Africa
  ALG: "Algeria", CMR: "Cameroon",
  EGY: "Egypt", ERI: "Eritrea", ETH: "Ethiopia",
  GAB: "Gabon", GHA: "Ghana", KEN: "Kenya",
  MAR: "Morocco", NAM: "Namibia", NGR: "Nigeria", NGA: "Nigeria",
  RSA: "South Africa", RWA: "Rwanda",
  SEN: "Senegal", TUN: "Tunisia", UGA: "Uganda",
  BUR: "Burkina Faso",

  // Asia / Pacific
  AUS: "Australia", CHN: "China", HKG: "Hong Kong",
  INA: "Indonesia", IDN: "Indonesia",
  IND: "India", IRI: "Iran", IRN: "Iran",
  IRQ: "Iraq", ISR: "Israel",
  JPN: "Japan", KOR: "South Korea",
  MAS: "Malaysia", MYS: "Malaysia",
  MGL: "Mongolia", MNG: "Mongolia",
  NZL: "New Zealand", PAK: "Pakistan",
  PHI: "Philippines", PHL: "Philippines",
  SGP: "Singapore", SIN: "Singapore",
  SRI: "Sri Lanka", LKA: "Sri Lanka",
  THA: "Thailand", TPE: "Chinese Taipei",
  VIE: "Vietnam", VNM: "Vietnam",
};

/**
 * Get the display name for a country code.
 * Returns the full country name, or the raw code if not found.
 */
export function getCountryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}
