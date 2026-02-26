import { config } from 'dotenv';
config({ path: '.env.local' });
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  await page.goto('https://www.procyclingstats.com/race/omloop-het-nieuwsblad/2026/startlist', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const teamEl = document.querySelector('.startlist_v4 > li');
    if (!teamEl) return { error: 'no team element' };
    
    // Get full innerHTML
    const html = teamEl.innerHTML.substring(0, 500);
    
    // Try different selectors
    const titleEl = teamEl.querySelector('[title]');
    const allLinks = teamEl.querySelectorAll('a');
    const linkInfo = Array.from(allLinks).slice(0, 3).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent?.trim(),
      title: a.getAttribute('title'),
      dataTeam: a.getAttribute('data-team'),
    }));
    
    // Get team href
    const teamLink = teamEl.querySelector('a[href*="team/"]') as HTMLAnchorElement | null;
    const teamHref = teamLink?.getAttribute('href') || '';
    const teamSlug = teamHref.split('/')[1]?.replace(/-\d{4}$/, '') || '';
    
    // Try alt/title attributes on images
    const imgs = teamEl.querySelectorAll('img');
    const imgInfo = Array.from(imgs).slice(0, 2).map(img => ({
      src: img.getAttribute('src')?.substring(0, 60),
      alt: img.getAttribute('alt'),
      title: img.getAttribute('title'),
    }));
    
    return { html, linkInfo, teamHref, teamSlug, imgInfo };
  });
  
  console.log('Team element info:', JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error).finally(() => process.exit(0));
