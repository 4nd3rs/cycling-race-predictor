import { config } from 'dotenv';
config({ path: '.env.local' });

async function scrapeDo(url: string, render = true) {
  const token = process.env.SCRAPE_DO_TOKEN!;
  const params = new URLSearchParams({ token, url, render: String(render) });
  const res = await fetch('https://api.scrape.do?' + params, { signal: AbortSignal.timeout(45000) });
  return { status: res.status, text: await res.text() };
}

async function main() {
  // The UCI rankings page rendered - look for API URLs
  const r = await scrapeDo('https://www.uci.org/mountain-bike/rankings', true);
  console.log('Status:', r.status);
  const text = r.text;
  
  // Search for API URLs
  const apiMatches = [...new Set((text.match(/https?:\/\/[^"']+api[^"']{0,100}/gi) || []))];
  console.log('API URLs found:', apiMatches.slice(0, 20));
  
  // Look for dataride
  const dataRideMatches = text.match(/dataride[^"']{0,200}/gi) || [];
  console.log('DataRide refs:', dataRideMatches.slice(0, 5));
  
  // Look for ranking endpoints
  const rankMatches = [...new Set((text.match(/https?:\/\/[^"']+[Rr]anking[^"']{0,100}/gi) || []))];
  console.log('Ranking URLs:', rankMatches.slice(0, 20));
  
  // Look for iframe
  const iframes = text.match(/iframe[^>]{0,200}/gi) || [];
  console.log('Iframes:', iframes.slice(0, 5));
}

main().catch(console.error);
