/**
 * scrape-do.ts — Shared scrape.do HTTP API wrapper
 *
 * Replaces Playwright browser automation with a simple HTTP call.
 * Returns rendered HTML (JavaScript executed) ready for cheerio parsing.
 */

export async function scrapeDo(
  url: string,
  options?: { render?: boolean; timeout?: number }
): Promise<string> {
  const token = process.env.SCRAPE_DO_TOKEN;
  if (!token) throw new Error("SCRAPE_DO_TOKEN not set");

  const params = new URLSearchParams({
    token,
    url,
    render: String(options?.render ?? true),
  });

  const res = await fetch(`https://api.scrape.do?${params}`, {
    signal: AbortSignal.timeout(options?.timeout ?? 30000),
  });

  if (!res.ok) {
    throw new Error(`scrape.do ${res.status}: ${url}`);
  }

  return res.text();
}
