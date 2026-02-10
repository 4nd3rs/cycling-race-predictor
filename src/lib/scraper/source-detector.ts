/**
 * Unified Source Detection
 *
 * Detects the data source from a URL and returns its capabilities.
 * Easy to extend with new sources by adding to SOURCES array.
 */

export type SourceType =
  | "procyclingstats"
  | "rockthesport"
  | "copa_catalana"
  | "cronomancha"
  | "firstcycling"
  | "xcodata"
  | "unknown";

export type DataType = "startlist" | "results" | "rankings" | "race_info";

export interface SourceCapabilities {
  sourceType: SourceType;
  displayName: string;
  dataTypes: DataType[];
  hasCategories: boolean;
  hasPdfs: boolean;
  requiresPdfUpload?: boolean; // Source needs manual PDF startlist upload
  discipline: "road" | "mtb_xco" | "mtb_xcc" | "mixed";
  defaultCountry?: string;
}

interface SourcePattern {
  pattern: RegExp;
  capabilities: SourceCapabilities;
}

/**
 * Registry of supported sources.
 * Add new sources here to extend support.
 */
const SOURCES: SourcePattern[] = [
  {
    pattern: /procyclingstats\.com/,
    capabilities: {
      sourceType: "procyclingstats",
      displayName: "ProCyclingStats",
      dataTypes: ["startlist", "results", "race_info"],
      hasCategories: false,
      hasPdfs: false,
      discipline: "road",
    },
  },
  {
    pattern: /rockthesport\.com/,
    capabilities: {
      sourceType: "rockthesport",
      displayName: "Rockthesport",
      dataTypes: ["startlist"],
      hasCategories: true,
      hasPdfs: false,
      discipline: "mtb_xco",
      defaultCountry: "ESP",
    },
  },
  {
    pattern: /cronomancha\.com/,
    capabilities: {
      sourceType: "cronomancha",
      displayName: "Cronomancha",
      dataTypes: ["startlist"],
      hasCategories: true,
      hasPdfs: false,
      requiresPdfUpload: true,
      discipline: "mtb_xco",
      defaultCountry: "ESP",
    },
  },
  {
    pattern: /copacatalanabtt\.com/,
    capabilities: {
      sourceType: "copa_catalana",
      displayName: "Copa Catalana BTT",
      dataTypes: ["results"],
      hasCategories: true,
      hasPdfs: true,
      discipline: "mtb_xco",
      defaultCountry: "ESP",
    },
  },
  {
    pattern: /firstcycling\.com/,
    capabilities: {
      sourceType: "firstcycling",
      displayName: "FirstCycling",
      dataTypes: ["startlist", "results", "race_info"],
      hasCategories: false,
      hasPdfs: false,
      discipline: "road",
    },
  },
  {
    pattern: /xcodata\.com/,
    capabilities: {
      sourceType: "xcodata",
      displayName: "XCOdata",
      dataTypes: ["rankings"],
      hasCategories: true,
      hasPdfs: false,
      discipline: "mtb_xco",
    },
  },
];

/**
 * Detect the source type and capabilities from a URL
 */
export function detectSource(url: string): SourceCapabilities {
  const lowerUrl = url.toLowerCase();

  for (const source of SOURCES) {
    if (source.pattern.test(lowerUrl)) {
      return source.capabilities;
    }
  }

  return {
    sourceType: "unknown",
    displayName: "Unknown",
    dataTypes: [],
    hasCategories: false,
    hasPdfs: false,
    discipline: "mixed",
  };
}

/**
 * Check if a source type is supported
 */
export function isSourceSupported(url: string): boolean {
  return detectSource(url).sourceType !== "unknown";
}

/**
 * Get all supported source patterns for display
 */
export function getSupportedSources(): Array<{
  name: string;
  example: string;
  types: string[];
}> {
  return [
    {
      name: "ProCyclingStats",
      example: "procyclingstats.com/race/...",
      types: ["Road startlists", "Results"],
    },
    {
      name: "Rockthesport",
      example: "rockthesport.com/en/event/.../participant-list",
      types: ["MTB startlists"],
    },
    {
      name: "Copa Catalana BTT",
      example: "copacatalanabtt.com/en/classifications/",
      types: ["MTB results (PDF)"],
    },
  ];
}
