// Targeted independent-review reproductions and rechecks against the static export.
import fs from "node:fs";
import path from "node:path";

export async function reviewRegressions({
  page, url, root, check, scanAxe, shot, errors, results, axeResults, requests,
  configure, before,
}) {
  const observations = { layouts: [], headings: [], settlers: [] };
  const synced = () => page.getByText("Synced · block", { exact: false }).waitFor();
  const geometry = () => page.evaluate(() => ({
    viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    fields: [...document.querySelectorAll(".filter-fields, .filter-fields label, .filter-tabs button")].map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.tagName === "LABEL" ? el.firstChild.textContent.trim() : el.className || el.textContent, x: r.x, right: r.right, width: r.width, height: r.height };
    }),
  }));
  configure({ scenario: "recorded" });
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto(url + "#/markets");
  await synced();
  await page.evaluate(() => document.fonts.ready);
  observations.layouts.push(await geometry());
  await shot(before ? "review-before-markets-768" : "review-markets-768");
  check(before ? "Reproduced 768px Markets overflow" : "Markets fits 768px tablet", before
    ? observations.layouts[0].scrollWidth === 856
    : observations.layouts[0].scrollWidth === 768);
  if (!before) {
    for (const width of [320, 360, 390, 680, 681, 720, 767, 769, 820, 883, 884, 900, 901, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const g = await geometry(); observations.layouts.push(g);
      check(`Every Markets field, label and status control fits at ${width}px`,
        g.scrollWidth === width && g.fields.every((f) => f.x >= 0 && f.right <= width && f.height > 0));
    }
    await page.setViewportSize({ width: 768, height: 844 });
    await page.getByLabel("Search questions").focus();
    await page.keyboard.type("WETH");
    await page.keyboard.press("Tab");
    check("Keyboard reaches Token after search", await page.getByRole("combobox", { name: "Token", exact: true }).evaluate((e) => e === document.activeElement));
    await page.getByRole("combobox", { name: "Token", exact: true }).selectOption("WETH");
    await page.keyboard.press("Tab");
    check("Keyboard reaches Sort by after Token", await page.getByLabel("Sort by").evaluate((e) => e === document.activeElement));
    await page.getByLabel("Sort by").selectOption("pool");
    await shot("review-markets-keyboard-768");
    check("Search, token and sort filters preserve the matching WETH market", await page.locator(".market-card").count() === 1 && (await page.locator(".market-card").innerText()).includes("WETH refund market"));
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("heading", { name: "No markets match" }).waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    check("Clear filters restores both markets", await page.locator(".market-card").count() === 2);
    await scanAxe("Markets, tablet 768px, dark");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).first().click();
    await page.setViewportSize({ width: 768, height: 844 });
    await scanAxe("Markets, tablet 768px, light");
    await shot("review-markets-light-768");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, title, previous] of [
    ["markets", "Markets", "Every question. On chain."],
    ["leaderboard", "Leaderboard", "On the record."],
    ["create", "Create a market", "Put a question on chain."],
  ]) {
    await page.goto(url + "#/" + route);
    const heading = await page.locator("h1").innerText();
    observations.headings.push({ route, heading });
    check(`${route} heading ${before ? "reproduction" : "names its task"}`, heading === (before ? previous : title));
    if (!before) {
      check(`${route} heading stays on the first 390px screen`, await page.locator("h1").evaluate((e) => e.getBoundingClientRect().bottom <= 844));
      await shot("review-" + route + "-390");
    }
  }
  configure({ scenario: "settlers-zero" });
  await page.goto(url + "#/leaderboard");
  await page.reload();
  await synced();
  await page.getByRole("button", { name: "Settlers", exact: true }).click();
  for (const period of ["all", "week"]) {
    await page.getByLabel("Period").selectOption(period);
    const rows = await page.locator("tbody tr").allInnerTexts();
    observations.settlers.push({ period, rows });
    check(before ? `Reproduced omitted zero-reward settlers (${period})` : `Zero-reward settlers keep all four actions (${period})`, before
      ? rows.length === 0 && await page.getByRole("heading", { name: "No IMD rankings yet" }).isVisible()
      : rows.length === 2 && rows.every((r) => /0\s*IMD/.test(r)) && rows.map((r) => Number(r.trim().split(/\s+/).at(-1))).sort().join() === "1,3");
  }
  await shot(before ? "review-before-zero-reward-settlers" : "review-zero-reward-settlers-390");
  if (!before) {
    const tableRegion = page.getByRole("region", { name: "IMD Settlers rankings" });
    await tableRegion.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".table-scroll").scrollLeft > 0);
    check("Keyboard can scroll to the settler reward and action columns", await tableRegion.evaluate((e) => e.scrollLeft > 0));
    await tableRegion.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
    await shot("review-zero-reward-settlers-values-390");
    check("Zero-reward leaderboard has no unverified callers or document overflow", await page.getByText("unverified caller", { exact: false }).count() === 0 && await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    check("Settlement transaction envelopes were actually read", requests.filter((r) => r.method === "eth_getTransactionByHash").length >= 4);
    await scanAxe("Zero-reward settlers, 390px, light");
    configure({ failTransaction: true });
    await page.reload();
    await synced();
    await page.getByRole("button", { name: "Settlers", exact: true }).click();
    check("Unavailable caller data is disclosed without breaking market reads", await page.getByText("4 settlement actions have", { exact: false }).isVisible());
    configure({ failTransaction: false });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator("tbody tr").first().waitFor();
    check("Refresh retries failed caller lookups and recovers both zero-reward rows", await page.locator("tbody tr").count() === 2 && await page.getByText("unverified caller", { exact: false }).count() === 0);
  }
  check("Review regression flows have no uncaught browser errors", errors.length === 0);
  const report = {
    checkedAt: new Date().toISOString(), before, browser: "Chromium",
    scope: "Production dist under /preview/; all external requests intercepted, zero broadcasts",
    results, observations, axeResults, errors,
  };
  const output = before ? "review-reproduction.json" : "review-regressions.json";
  fs.writeFileSync(path.join(root, "web/validation", output), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: output, checks: results.length }));
}
