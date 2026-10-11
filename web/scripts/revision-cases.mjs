// Regression cases run against dist/ by wallet-check.mjs --revision.
// The shared harness intercepts every external RPC and never broadcasts a transaction.
import fs from "node:fs";
import path from "node:path";

export async function revisionChecks({
  page, url, root, check, connect, scanAxe, requests, errors, results, axeResults,
  configure,
}) {
  const observations = {};
  // Install before the app registers its refresh interval.
  await page.clock.install();
  const synced = () => page.getByText("Synced · block", { exact: false }).waitFor();
  const refresh = async (advanceBlock = false) => {
    configure({ advanceBlock });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await synced();
  };
  const screenshot = (name) => page.screenshot({ path: path.join(root, `artifacts/revision-${name}.png`) });
  const transactionReads = () => requests.filter((r) => r.method === "eth_getTransactionByHash").length;
  const draft = () => page.locator(".create-layout").evaluate((element) => ({
    fields: [...element.querySelectorAll("input, textarea, select")].map((el) => el.value),
    review: element.querySelector("#create-review")?.textContent,
  }));
  const typography = (selector) => page.locator(selector).evaluateAll((elements) => elements.map((el) => ({
    text: el.textContent, family: getComputedStyle(el).fontFamily,
    weight: getComputedStyle(el).fontWeight, stretch: getComputedStyle(el).fontStretch,
    tracking: getComputedStyle(el).letterSpacing,
  })));
  const mono = (items) => items.length > 0 && items.every((x) => x.family.includes("IBM Plex Mono") && x.weight === "500" && x.stretch === "100%" && x.tracking === "normal");

  configure({ scenario: "recorded" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await synced();
  await page.evaluate(() => document.fonts.ready);
  observations.home = await page.evaluate(() => {
    const box = (selector) => {
      const b = document.querySelector(selector).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    };
    return { hero: box(".hero"), stats: box(".stats-grid"), question: box(".market-card h3"), action: box(".market-card .card-bottom a"), heading: document.querySelector(".home-markets h2").textContent };
  });
  console.log("Home geometry", JSON.stringify(observations.home));
  check("390px first screen contains a complete recent question and View market action", observations.home.question.top > 0 && observations.home.question.bottom < 844 && observations.home.action.bottom <= 844);
  check("Recent markets precede the statistics when none are open", observations.home.heading === "Recent markets" && observations.home.stats.top > observations.home.action.bottom);
  check("Empty state clearly says no markets are open", await page.getByRole("heading", { name: "No markets are open for betting", exact: true }).count() === 1);
  check("Empty state retains the settled-market action", await page.getByRole("link", { name: "Explore settled markets", exact: false }).count() === 1);
  observations.stats = await typography(".stat > strong");
  check("Homepage totals use IBM Plex Mono 500 without heading stretch or tracking", mono(observations.stats));
  await screenshot("home-mobile");
  await scanAxe("revised home, dark, 390px");
  for (const width of [360, 320, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(`Revised home has no document overflow at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  }
  await screenshot("home-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + "#/create");
  await connect();
  await page.locator("#create-question").fill("Which outcome will the panel select?");
  await page.getByLabel("Answer type").selectOption("bytes32[]");
  const keys = ["0x" + "a".repeat(64), "0x" + "b".repeat(64)];
  await page.locator("#create-keys").fill(keys.join("\n"));
  await page.locator("#create-fromBlock").fill("30000000");
  await page.locator("#create-toBlock").fill("30000100");
  await page.getByText("Definitions and numerical tolerance", { exact: true }).click();
  await page.locator("#create-definitions").fill('{"2":"two","10":"ten"}');
  for (const [field, value] of Object.entries({ closeAt: "2030-01-01T12:00", answerFrom: "2030-01-01T13:00", answerUntil: "2030-01-03T12:00", voidAfter: "2030-01-04T12:00" }))
    await page.locator("#create-" + field).fill(value);
  await page.getByRole("button", { name: "Review market", exact: false }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#create-review").waitFor();
  check("Keyboard review focuses the review panel", await page.locator("#create-review").evaluate((el) => el === document.activeElement));
  check("Both full bytes32 keys and None of these remain in the review", await page.locator("#create-review > p").first().textContent() === [...keys, "None of these"].join(" · "));
  observations.listWidths = [];
  for (const width of [390, 360, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const measure = await page.evaluate(() => {
      const paragraph = document.querySelector("#create-review > p");
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, paragraph: paragraph.scrollWidth, content: paragraph.clientWidth, font: getComputedStyle(paragraph).fontFamily };
    });
    observations.listWidths.push(measure);
    check(`Complete list keys wrap within the review and viewport at ${width}px`, measure.document === width && measure.paragraph === measure.content && measure.font.includes("IBM Plex Mono"));
  }
  observations.time = await page.locator("#create-review time").evaluate((el) => ({ text: el.textContent, title: el.title, dateTime: el.dateTime }));
  check("Creator review uses Taipei local time with the exact UTC hover value", observations.time.text.includes("12:00") && observations.time.dateTime === "2030-01-01T04:00:00.000Z" && observations.time.title === "Tue, 01 Jan 2030 04:00:00 GMT");
  check("Schedule helper no longer promises a UTC-only review", !(await page.locator("body").innerText()).includes("Review shows UTC"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#create-review").scrollIntoViewIfNeeded();
  await screenshot("list-review-mobile");
  await scanAxe("list creator review, dark, Taipei, 390px");
  const before = await draft();
  await refresh(true);
  await page.getByRole("button", { name: "Review market", exact: false }).waitFor();
  check("New-block refresh preserves every creator field and the review", JSON.stringify(await draft()) === JSON.stringify(before));
  const nextBlock = configure({ advanceBlock: true });
  const blockReads = requests.filter((r) => r.method === "eth_getBlockByNumber").length;
  const automaticRead = page.waitForRequest((request) => request.postDataJSON()?.method === "eth_getBlockByNumber");
  await page.clock.fastForward(31000);
  await automaticRead;
  await page.getByText(`Synced · block ${nextBlock.toLocaleString()}`, { exact: false }).waitFor();
  check("Scheduled refresh runs and preserves the draft and review", requests.filter((r) => r.method === "eth_getBlockByNumber").length > blockReads && JSON.stringify(await draft()) === JSON.stringify(before));
  await page.clock.resume();

  configure({ failAccess: true });
  await refresh(true);
  await page.getByText("Could not check creator access", { exact: true }).waitFor();
  check("Temporary allowlist failure preserves the draft", JSON.stringify(await draft()) === JSON.stringify(before));
  check("Creation is disabled while access cannot be verified", await page.getByRole("button", { name: "Approve bounty & create market", exact: false }).isDisabled());
  configure({ failAccess: false });
  await page.getByRole("button", { name: "Retry access check" }).click();
  await page.getByText("Could not check creator access", { exact: true }).waitFor({ state: "hidden" });
  check("Access retry restores the same draft and review", JSON.stringify(await draft()) === JSON.stringify(before));
  configure({ allowed: false });
  await refresh(true);
  await page.getByRole("heading", { name: "This wallet isn’t an approved creator" }).waitFor();
  check("Actual allowlist revocation removes the creator form", await page.locator("#create-question").count() === 0);
  configure({ allowed: true });
  await refresh(true);
  await page.locator("#create-question").waitFor();
  await page.locator("#create-question").fill("A wallet-specific draft");
  await page.evaluate(() => window.emitWalletEvent("accountsChanged", []));
  await page.getByRole("heading", { name: "Creators start with a wallet" }).waitFor();
  await connect();
  check("Disconnecting and reconnecting resets the wallet-specific draft", await page.locator("#create-question").inputValue() === "");

  configure({ scenario: "answered", failTransaction: true });
  await page.goto(url + "#/market/1");
  await page.reload();
  await connect();
  await page.getByText("Could not verify this attestation:", { exact: false }).waitFor();
  const fallback = page.getByRole("link", { name: "Open oracle explorer", exact: false });
  observations.fallback = await fallback.getAttribute("href");
  check("Attestation failure offers the oracle directory, not a request ID as a job", observations.fallback === "https://explorer.imd.fun/oracle");
  check("Attestation failure displays the request UUID", await page.getByText("Request 0b26a0ed-870e-4c24-bc6d-db4447fb74a8", { exact: true }).isVisible());
  check("Submit answer stays disabled for unverified data", await page.getByRole("button", { name: "Submit answer", exact: true }).isDisabled());
  await page.locator(".notice.error").scrollIntoViewIfNeeded();
  await screenshot("attestation-error");
  configure({ failTransaction: false });
  const reads = transactionReads();
  await refresh();
  await page.getByText("Hash verified", { exact: false }).waitFor();
  observations.retriedTransactionReads = transactionReads() - reads;
  check("Refresh retries transaction recovery with no new events or block", observations.retriedTransactionReads > 0);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((el) => el.textContent.includes("Submit answer") && !el.disabled));
  check("Recovered answer becomes available for proposal", await page.getByRole("button", { name: "Submit answer", exact: true }).isEnabled());
  check("Successful evidence links only the attested panel job", await page.locator('a[href^="https://explorer.imd.fun/jobs/"]').evaluateAll((links) => links.length > 0 && links.every((link) => link.href === "https://explorer.imd.fun/jobs/7db3a0cb-2612-4694-85c1-ffd0e0b5e43e")));
  const verifiedReads = transactionReads();
  configure({ failTransaction: true });
  await refresh(true);
  await page.getByText("Hash verified", { exact: false }).waitFor();
  check("Further refreshes retain the verified attestation without rereading its transaction", transactionReads() === verifiedReads);
  configure({ failTransaction: false });

  configure({ scenario: "portfolio" });
  await page.goto(url + "#/portfolio");
  await page.reload();
  await connect();
  await page.locator(".portfolio-stats .number").first().waitFor();
  observations.portfolio = await typography(".portfolio-stats .stat strong .number");
  check("Portfolio totals use IBM Plex Mono 500", mono(observations.portfolio));
  await page.goto(url + "#/how-it-works");
  observations.fees = await typography(".fee-grid strong");
  check("Fee percentages use IBM Plex Mono 500", mono(observations.fees));

  configure({ scenario: "open" });
  await page.goto(url);
  await page.reload();
  await synced();
  check("Open markets still lead the home section when available", await page.locator(".home-markets h2").textContent() === "Open markets");
  check("No empty-market message appears when a market is open", await page.getByRole("heading", { name: "No markets are open for betting" }).count() === 0);
  await screenshot("home-open-mobile");
  check("Revision interactions produce no uncaught browser errors", errors.length === 0);
  const report = { checkedAt: new Date().toISOString(), scope: "Production dist/; captured RPC fixture and simulated EIP-6963 provider; no broadcasts", results, observations, axeResults, errors };
  fs.writeFileSync(path.join(root, "artifacts/revision-results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
