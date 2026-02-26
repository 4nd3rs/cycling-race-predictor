/**
 * Debug PCS startlist team extraction
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  
  console.log('Loading PCS startlist...');
  await page.goto('https://www.procyclingstats.com/race/omloop-het-nieuwsblad/2026/startlist', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // Check what selectors are present
  const debug = await page.evaluate(() => {
    const results: Record<string, number> = {};
    results['startlist_v4 count'] = document.querySelectorAll('.startlist_v4').length;
    results['startlist_v4 > li count'] = document.querySelectorAll('.startlist_v4 > li').length;
    results['ul.startlist > li'] = document.querySelectorAll('ul.startlist > li').length;
    results['table.basic tr count'] = document.querySelectorAll('table.basic tr').length;
    results['.ridersCont li count'] = document.querySelectorAll('.ridersCont li').length;
    
    // Try to get team names
    const teamEls = document.querySelectorAll('.startlist_v4 > li');
    const teamNames: string[] = [];
    teamEls.forEach((el, i) => {
      if (i < 5) {
        const nameEl = el.querySelector('b, .team-name, h3, a[href*="team/"]');
        teamNames.push(`[${i}] querySelector="${nameEl?.textContent?.trim() || 'null'}" | innerHTML_first_100="${el.innerHTML.substring(0, 100)}"`);
      }
    });
    results['first 5 team elements'] = teamNames.length;
    
    return { counts: results, teamNames };
  });

  console.log('Counts:', debug.counts);
  console.log('\nTeam elements:');
  debug.teamNames.forEach(t => console.log('  ', t));
  
  await browser.close();
}

main().catch(console.error).finally(() => process.exit(0));
