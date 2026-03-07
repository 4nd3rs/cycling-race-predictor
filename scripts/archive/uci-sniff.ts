import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let rankingResponse: string = "";
  let rankingPostBody: string = "";

  page.on("request", req => {
    if (req.url().includes("RankingsDiscipline")) {
      rankingPostBody = req.postData() || "";
      console.log("POST body:", rankingPostBody);
    }
    if (req.url().includes("GetRankingsCategories")) {
      console.log("Categories URL:", req.url());
    }
  });

  page.on("response", async res => {
    if (res.url().includes("RankingsDiscipline")) {
      rankingResponse = await res.text().catch(() => "");
      console.log("RankingsDiscipline response (first 2000 chars):");
      console.log(rankingResponse.substring(0, 2000));
    }
    if (res.url().includes("GetRankingsCategories")) {
      const t = await res.text().catch(() => "");
      console.log("Categories response:", t.substring(0, 500));
    }
    if (res.url().includes("GetDisciplineSeasons")) {
      const t = await res.text().catch(() => "");
      console.log("Seasons response:", t.substring(0, 500));
    }
  });

  await page.goto("https://dataride.uci.ch/iframe/rankings/7", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await browser.close();
}
main().catch(console.error);
