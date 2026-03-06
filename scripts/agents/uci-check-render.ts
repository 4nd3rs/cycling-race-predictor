import { config } from "dotenv";
config({ path: ".env.local" });
const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN!;

async function extractBearerToken(): Promise<string> {
  const params = new URLSearchParams({
    token: SCRAPE_DO_TOKEN,
    url: "https://www.uci.org/discipline/mountain-bike/4LArSj7CKcytMrGEDtKwkb?tab=rankings&discipline=MTB",
    render: "true", waitFor: "5000",
  });
  const res = await fetch("https://api.scrape.do?" + params, { signal: AbortSignal.timeout(60000) });
  const html = await res.text();
  const match = html.match(/bearerToken&quot;:&quot;(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/);
  if (!match) throw new Error("No bearer token");
  return match[1];
}

async function callUCI(token: string, params: Record<string, string>, cookie = ""): Promise<{ count: number; raw?: any }> {
  const url = "https://www.uci.org/api/rankings/details?" + new URLSearchParams(params);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Origin: "https://www.uci.org",
    Referer: "https://www.uci.org/discipline/mountain-bike/4LArSj7CKcytMrGEDtKwkb?tab=rankings",
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  const data = await res.json() as any;
  const count = (data?.mens?.results?.length ?? 0) + (data?.womens?.results?.length ?? 0);
  return { count, raw: count === 0 ? { keys: Object.keys(data), mensKeys: Object.keys(data.mens ?? {}) } : data };
}

async function interceptNetworkCalls(): Promise<void> {
  // Use playWithPage to intercept fetch calls made by the UCI page
  const playScript = `async () => {
    // Override fetch to capture API calls
    const origFetch = window.fetch;
    const calls = [];
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const result = await origFetch.apply(this, args);
      if (url.includes('/api/rankings') || url.includes('dataride')) {
        const clone = result.clone();
        const body = await clone.text().catch(() => '');
        calls.push({ url, bodyLen: body.length, sample: body.substring(0, 200) });
      }
      return result;
    };
    
    // Wait for page to make its calls
    await new Promise(r => setTimeout(r, 15000));
    
    // Inject captured calls into DOM
    const el = document.createElement('div');
    el.id = 'network-captures';
    el.style.display = 'none';
    el.textContent = JSON.stringify(calls);
    document.body.appendChild(el);
  }`;

  const params = new URLSearchParams({
    token: SCRAPE_DO_TOKEN,
    url: "https://www.uci.org/discipline/mountain-bike/4LArSj7CKcytMrGEDtKwkb?tab=rankings&discipline=MTB",
    render: "true", waitFor: "3000", playWithPage: playScript,
  });
  const res = await fetch("https://api.scrape.do?" + params, { signal: AbortSignal.timeout(90000) });
  const html = await res.text();
  
  // Look for the network captures
  const capturesMatch = html.match(/id="network-captures"[^>]*>([^<]*)/);
  if (capturesMatch) {
    console.log("Captured network calls:", capturesMatch[1].substring(0, 500));
  } else {
    console.log("No network captures found. Checking if div exists...");
    console.log("Has network-captures:", html.includes("network-captures"));
  }
}

async function main() {
  const COOKIE = "asp_uci_tr_sessionId=izpslnwqcjsab0u2oqikxkum";
  
  console.log("Getting bearer token...");
  const token = await extractBearerToken();
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const exp = new Date(payload.exp * 1000);
  const now = new Date();
  console.log(`Token: valid for ${Math.round((exp.getTime() - now.getTime()) / 60000)} min`);

  console.log("\n=== Testing different parameter combinations ===");
  const tests = [
    // Different Category values
    { DisciplineCode: "MTB", SeasonYear: "2026", Category: "All", rankingType: "Individual" },
    { DisciplineCode: "MTB", SeasonYear: "2026", Category: "MenElite", rankingType: "Individual" },
    { DisciplineCode: "MTB", SeasonYear: "2026", Category: "Elite Men", rankingType: "Individual" },
    { DisciplineCode: "MTB", SeasonYear: "2026", rankingType: "Individual" },  // no Category
    // Different DisciplineCode values
    { DisciplineCode: "XCO", SeasonYear: "2026", Category: "Elite", rankingType: "Individual" },
    { DisciplineCode: "XCO", SeasonYear: "2026", rankingType: "Individual" },
    { DisciplineCode: "MTB", SeasonYear: "2026", Category: "Elite", rankingType: "UCI" },
    // Try with cookie
    ...[
      { DisciplineCode: "MTB", SeasonYear: "2026", Category: "Elite", rankingType: "Individual" },
    ].map(p => ({ ...p, _useCookie: true })),
  ];

  for (const test of tests) {
    const { _useCookie, ...p } = test as any;
    try {
      const result = await callUCI(token, p, _useCookie ? COOKIE : "");
      const label = Object.entries(p).map(([k,v]) => `${k}=${v}`).join(" ") + (_useCookie ? " +cookie" : "");
      console.log(`${result.count > 0 ? "✅" : "❌"} ${label} → ${result.count} results`);
      if (result.count > 0) {
        console.log("  Sample:", JSON.stringify(result.raw?.mens?.results?.[0]));
      }
    } catch(e: any) {
      console.log(`❌ Error: ${e.message.substring(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log("\n=== Intercepting page network calls ===");
  await interceptNetworkCalls();
}
main().catch(console.error);
