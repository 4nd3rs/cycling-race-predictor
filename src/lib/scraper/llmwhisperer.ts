/**
 * LLMWhisperer PDF Parsing Service
 *
 * Uses LLMWhisperer API for robust PDF text extraction with table layout preservation.
 * Much more reliable than regex-based parsing for structured race result PDFs.
 */

import { LLMWhispererClientV2 } from "llmwhisperer-client";

// Lazy-initialize client to ensure env vars are loaded
let _client: LLMWhispererClientV2 | null = null;

function getClient(): LLMWhispererClientV2 {
  if (!_client) {
    const apiKey = process.env.LLMWHISPERER_API_KEY;
    if (!apiKey) {
      throw new Error("LLMWHISPERER_API_KEY environment variable is not set");
    }
    _client = new LLMWhispererClientV2({
      baseUrl: "https://llmwhisperer-api.us-central.unstract.com/api/v2",
      apiKey,
      apiTimeout: 120, // 2 minutes for large PDFs
    });
  }
  return _client;
}

export interface ExtractedPdfResult {
  text: string;
  pages: number;
  processingTime: number;
}

/**
 * Extract text from a PDF URL using LLMWhisperer
 * Uses 'table' mode for race results which preserves table structure
 */
export async function extractPdfText(
  pdfUrl: string,
  options: {
    mode?: "native_text" | "low_cost" | "high_quality" | "form" | "table";
    outputMode?: "layout_preserving" | "text";
  } = {}
): Promise<ExtractedPdfResult | null> {
  const { mode = "table", outputMode = "layout_preserving" } = options;

  try {
    console.log(`[LLMWhisperer] Extracting PDF: ${pdfUrl}`);
    const startTime = Date.now();

    // Start the whisper operation
    const client = getClient();
    const whisperResult = await client.whisper({
      url: pdfUrl,
      mode,
      outputMode,
      pageSeparator: "<<<PAGE>>>",
    }) as { whisperHash?: string; whisper_hash?: string };

    // Handle both camelCase and snake_case response formats
    const whisperHash = whisperResult.whisperHash || whisperResult.whisper_hash;

    if (!whisperHash) {
      console.error("[LLMWhisperer] No whisper hash returned:", whisperResult);
      return null;
    }

    // Poll for completion
    let status = await client.whisperStatus(whisperHash) as {
      status: string;
      pageCount?: number;
      page_count?: number;
    };
    let attempts = 0;
    const maxAttempts = 60; // 60 * 2s = 2 minutes max

    // Poll until processed (status can be: accepted, processing, processed)
    while ((status.status === "processing" || status.status === "accepted") && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await client.whisperStatus(whisperHash) as typeof status;
      attempts++;
    }

    if (status.status !== "processed") {
      console.error(`[LLMWhisperer] Processing failed: ${status.status}`);
      return null;
    }

    // Retrieve the extracted text
    const result = await client.whisperRetrieve(whisperHash) as {
      extractedText?: string;
      extracted_text?: string;
      text?: string;
      extraction?: { result_text?: string; extracted_text?: string } | string;
    };

    const processingTime = Date.now() - startTime;
    // Try different possible field names for the extracted text
    const extraction = result.extraction;
    const extractedText = result.extractedText || result.extracted_text || result.text ||
                          (typeof extraction === 'object' && extraction !== null
                            ? (extraction.result_text || extraction.extracted_text)
                            : (typeof extraction === 'string' ? extraction : "")) || "";
    console.log(`[LLMWhisperer] Extracted ${extractedText.length} chars in ${processingTime}ms`);

    return {
      text: extractedText,
      pages: status.pageCount || status.page_count || 1,
      processingTime,
    };
  } catch (error) {
    console.error("[LLMWhisperer] Error extracting PDF:", error);
    return null;
  }
}

/**
 * Parse race results from extracted PDF text
 * Works with the structured output from LLMWhisperer's table mode
 */
export interface ParsedRaceResult {
  position: number;
  bibNumber: number;
  name: string;
  category: string;
  team: string;
  laps: number;
  time: string;
  gap: string | null;
  dnf: boolean;
  dns: boolean;
}

export function parseRaceResultsFromText(text: string): ParsedRaceResult[] {
  const results: ParsedRaceResult[] = [];
  const lines = text.split("\n");

  // LLMWhisperer preserves table layout, so we can parse line by line
  // Look for lines that match the pattern: position bib name category team laps time [gap]

  // Common patterns in race result PDFs
  const resultPattern = /^\s*(\d+)\s+(\d+)\s+([A-ZÁÉÍÓÚÑÇÀ-ÿ][A-Za-záéíóúñçà-ÿ\s'-]+?)\s+(F\.?Sub23|F\.?Elit|Sub23|Elit|Junior|Cadet)\s+(.+?)\s+(\d+)\s+(\d*h?\d+:\d+\.\d+)(?:\s+(\+[\d:\.]+|\+\d+\s*Volta))?/i;

  for (const line of lines) {
    const match = line.match(resultPattern);
    if (match) {
      results.push({
        position: parseInt(match[1], 10),
        bibNumber: parseInt(match[2], 10),
        name: match[3].trim(),
        category: match[4],
        team: match[5].trim(),
        laps: parseInt(match[6], 10),
        time: match[7],
        gap: match[8] || null,
        dnf: false,
        dns: false,
      });
    }
  }

  // Also check for DNS/DNF sections
  const dnsMatch = text.match(/No\s+Sortits([\s\S]*?)(?:Abandons|$)/i);
  if (dnsMatch) {
    const dnsPattern = /(\d+)\s+([A-ZÁÉÍÓÚÑÇÀ-ÿ][A-Za-záéíóúñçà-ÿ\s'-]+?)\s+(F\.?Sub23|F\.?Elit|Sub23|Elit|Junior|Cadet)\s+(.+?)(?=\s*\d+\s+[A-Z]|\s*$)/gi;
    let dns;
    while ((dns = dnsPattern.exec(dnsMatch[1])) !== null) {
      results.push({
        position: 0,
        bibNumber: parseInt(dns[1], 10),
        name: dns[2].trim(),
        category: dns[3],
        team: dns[4].trim(),
        laps: 0,
        time: "",
        gap: null,
        dnf: false,
        dns: true,
      });
    }
  }

  const dnfMatch = text.match(/Abandons([\s\S]*?)(?:No\s+Sortits|$)/i);
  if (dnfMatch) {
    const dnfPattern = /(\d+)\s+([A-ZÁÉÍÓÚÑÇÀ-ÿ][A-Za-záéíóúñçà-ÿ\s'-]+?)\s+(F\.?Sub23|F\.?Elit|Sub23|Elit|Junior|Cadet)\s+(.+?)(?=\s*\d+\s+[A-Z]|\s*$)/gi;
    let dnf;
    while ((dnf = dnfPattern.exec(dnfMatch[1])) !== null) {
      results.push({
        position: 0,
        bibNumber: parseInt(dnf[1], 10),
        name: dnf[2].trim(),
        category: dnf[3],
        team: dnf[4].trim(),
        laps: 0,
        time: "",
        gap: null,
        dnf: true,
        dns: false,
      });
    }
  }

  // Deduplicate by bib number
  const uniqueResults = new Map<number, ParsedRaceResult>();
  for (const r of results) {
    if (!uniqueResults.has(r.bibNumber) || r.position > 0) {
      uniqueResults.set(r.bibNumber, r);
    }
  }

  return Array.from(uniqueResults.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.position === 0) return 1;
    if (b.position === 0) return -1;
    return a.position - b.position;
  });
}

/**
 * Extract and parse race results from a PDF URL
 */
export async function extractRaceResults(pdfUrl: string): Promise<{
  results: ParsedRaceResult[];
  rawText: string;
  pages: number;
} | null> {
  const extracted = await extractPdfText(pdfUrl, { mode: "table" });

  if (!extracted) {
    return null;
  }

  const results = parseRaceResultsFromText(extracted.text);

  return {
    results,
    rawText: extracted.text,
    pages: extracted.pages,
  };
}
