/**
 * UCI Nationality Code Conversion
 *
 * Converts between 2-letter ISO codes (from XCOdata) and 3-letter UCI codes.
 * UCI uses its own 3-letter codes which differ from ISO 3166-1 alpha-3 in several cases.
 */

const ISO2_TO_UCI3: Record<string, string> = {
  AD: "AND", AE: "UAE", AF: "AFG", AG: "ANT", AL: "ALB", AM: "ARM",
  AO: "ANG", AR: "ARG", AT: "AUT", AU: "AUS", AZ: "AZE",
  BA: "BIH", BB: "BAR", BD: "BAN", BE: "BEL", BF: "BUR", BG: "BUL",
  BH: "BRN", BI: "BDI", BJ: "BEN", BM: "BER", BN: "BRU", BO: "BOL",
  BR: "BRA", BS: "BAH", BT: "BHU", BW: "BOT", BY: "BLR", BZ: "BIZ",
  CA: "CAN", CD: "COD", CF: "CAF", CG: "CGO", CH: "SUI", CI: "CIV",
  CL: "CHI", CM: "CMR", CN: "CHN", CO: "COL", CR: "CRC", CU: "CUB",
  CV: "CPV", CY: "CYP", CZ: "CZE",
  DE: "GER", DJ: "DJI", DK: "DEN", DM: "DMA", DO: "DOM", DZ: "ALG",
  EC: "ECU", EE: "EST", EG: "EGY", ER: "ERI", ES: "ESP", ET: "ETH",
  FI: "FIN", FJ: "FIJ", FR: "FRA",
  GA: "GAB", GB: "GBR", GD: "GRN", GE: "GEO", GH: "GHA", GM: "GAM",
  GN: "GUI", GQ: "GEQ", GR: "GRE", GT: "GUA", GW: "GBS", GY: "GUY",
  HK: "HKG", HN: "HON", HR: "CRO", HT: "HAI", HU: "HUN",
  ID: "INA", IE: "IRL", IL: "ISR", IN: "IND", IQ: "IRQ", IR: "IRI",
  IS: "ISL", IT: "ITA",
  JM: "JAM", JO: "JOR", JP: "JPN",
  KE: "KEN", KG: "KGZ", KH: "CAM", KI: "KIR", KM: "COM", KN: "SKN",
  KP: "PRK", KR: "KOR", KW: "KUW", KZ: "KAZ",
  LA: "LAO", LB: "LBN", LC: "LCA", LI: "LIE", LK: "SRI", LR: "LBR",
  LS: "LES", LT: "LTU", LU: "LUX", LV: "LAT",
  LY: "LBA", MA: "MAR", MC: "MON", MD: "MDA", ME: "MNE", MG: "MAD",
  MK: "MKD", ML: "MLI", MM: "MYA", MN: "MGL", MR: "MTN", MT: "MLT",
  MU: "MRI", MV: "MDV", MW: "MAW", MX: "MEX", MY: "MAS", MZ: "MOZ",
  NA: "NAM", NE: "NIG", NG: "NGR", NI: "NCA", NL: "NED", NO: "NOR",
  NP: "NEP", NR: "NRU", NZ: "NZL",
  OM: "OMA",
  PA: "PAN", PE: "PER", PG: "PNG", PH: "PHI", PK: "PAK", PL: "POL",
  PR: "PUR", PS: "PLE", PT: "POR",
  QA: "QAT",
  RO: "ROU", RS: "SRB", RU: "RUS", RW: "RWA",
  SA: "KSA", SB: "SOL", SC: "SEY", SD: "SUD", SE: "SWE", SG: "SGP",
  SI: "SLO", SK: "SVK", SL: "SLE", SM: "SMR", SN: "SEN", SO: "SOM",
  SR: "SUR", SS: "SSD", ST: "STP", SV: "ESA", SY: "SYR", SZ: "SWZ",
  TD: "CHA", TG: "TOG", TH: "THA", TJ: "TJK", TL: "TLS", TM: "TKM",
  TN: "TUN", TO: "TGA", TR: "TUR", TT: "TTO", TV: "TUV", TW: "TPE",
  TZ: "TAN",
  UA: "UKR", UG: "UGA", US: "USA", UY: "URU", UZ: "UZB",
  VA: "VAT", VC: "VIN", VE: "VEN", VN: "VIE",
  VU: "VAN",
  WS: "SAM",
  XK: "KOS",
  YE: "YEM",
  ZA: "RSA", ZM: "ZAM", ZW: "ZIM",
};

/**
 * Convert a 2-letter ISO code to a 3-letter UCI nationality code.
 * Returns the input uppercased if no mapping found.
 */
export function iso2to3(code: string): string {
  const upper = code.toUpperCase().trim();
  return ISO2_TO_UCI3[upper] || upper;
}

/**
 * Normalize a nationality code to 3-letter UCI format.
 * Accepts both 2-letter ISO and 3-letter UCI codes.
 */
export function normalizeNationality(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.toUpperCase().trim();
  if (trimmed.length === 2) {
    return iso2to3(trimmed);
  }
  if (trimmed.length === 3) {
    return trimmed;
  }
  return null;
}
