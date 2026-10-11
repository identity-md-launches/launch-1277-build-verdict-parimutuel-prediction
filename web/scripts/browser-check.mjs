import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(
  process.env.VERDICT_NODE_MODULES
    ? path.join(process.env.VERDICT_NODE_MODULES, "../package.json")
    : import.meta.url,
);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = path.join(root, "dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  if (!pathname.startsWith("/preview/")) {
    res.writeHead(404).end();
    return;
  }
  const file = path.resolve(
    dist,
    pathname.slice("/preview/".length) || "index.html",
  );
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [],
  failures = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) =>
  failures.push({ url: r.url(), error: r.failure()?.errorText }),
);
const results = [];
const rendered = [];
async function measureTheme(theme) {
  const pairs = await page.evaluate(() => {
    const style = (selector) =>
      getComputedStyle(document.querySelector(selector));
    const bg = style("html").backgroundColor;
    return {
      pairs: [
        ["Body text", style("body").color, bg, 4.5],
        ["Secondary text", style(".hero-description").color, bg, 4.5],
        [
          "Surface text",
          style(".empty-state p").color,
          style(".empty-state").backgroundColor,
          4.5,
        ],
        [
          "Primary button",
          style(".hero-actions .primary").color,
          style(".hero-actions .primary").backgroundColor,
          4.5,
        ],
        [
          "Secondary button boundary",
          style(".empty-state .button").borderTopColor,
          style(".empty-state").backgroundColor,
          3,
        ],
        ["Large accent heading", style(".hero h1 span").color, bg, 3],
      ],
      heading: {
        family: style("h1").fontFamily,
        weight: style("h1").fontWeight,
        stretch: style("h1").fontStretch,
        size: style("h1").fontSize,
      },
      label: {
        family: style(".stat > span:first-child").fontFamily,
        size: style(".stat > span:first-child").fontSize,
      },
      fonts: [...document.fonts].map((f) => ({
        family: f.family,
        weight: f.weight,
        stretch: f.stretch,
        status: f.status,
      })),
    };
  });
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return channels.reduce(
      (total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i],
      0,
    );
  };
  const contrast = pairs.pairs.map(
    ([name, foreground, background, required]) => {
      const values = [luminance(foreground), luminance(background)].sort(
        (a, b) => a - b,
      );
      const ratio = (values[1] + 0.05) / (values[0] + 0.05);
      assert.ok(
        ratio >= required,
        `${theme} ${name} contrast ${ratio} < ${required}`,
      );
      return {
        name,
        foreground,
        background,
        ratio: Number(ratio.toFixed(3)),
        required,
      };
    },
  );
  rendered.push({ theme, ...pairs, pairs: contrast });
}
const check = (label, value) => {
  assert.ok(value, label);
  results.push(label);
};
const screenshot = (name) =>
  page.screenshot({
    path: path.join(root, "artifacts", name + ".png"),
    fullPage: true,
  });
try {
  if (process.argv.includes("--social")) {
    const font = fs
      .readFileSync(
        path.join(root, "web/public/fonts/archivo-expanded-800.woff2"),
      )
      .toString("base64");
    const logo = fs
      .readFileSync(path.join(root, "web/public/favicon.svg"), "utf8")
      .replace('<rect width="240" height="240" rx="48" fill="#0A0F0D"/>', "");
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(
      `<style>@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#0A0F0D;color:#F2EFE6;font-family:Archivo;font-weight:800;font-stretch:125%;padding:56px 64px}h1{font-size:68px;letter-spacing:-4px;line-height:1.12;margin:80px 0 30px;max-width:800px}h1 span{color:#2EE67A}.brand{font-size:32px}.mark{position:absolute;right:28px;top:110px;width:360px}p{font-family:Arial;font-size:24px;line-height:1.6;color:#A5B6A8;max-width:650px}.grid{position:absolute;inset:0 0 0 820px;background-image:linear-gradient(#19251E 1px,transparent 1px),linear-gradient(90deg,#19251E 1px,transparent 1px);background-size:36px 36px;z-index:-1}</style><div class="grid"></div><div class="brand">VERDICT</div><h1>Conviction meets<br><span>consensus.</span></h1><p>Prediction markets run by AI agents.<br>Settled by IMD’s oracle.</p><div class="mark">${logo}</div>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, "web/public/social.png") });
    console.log(
      "Generated 1200 × 630 social.png from local fonts and the exact Verdict logo.",
    );
  } else {
    await page.goto(url);
    await page
      .getByText("Synced · block", { exact: false })
      .waitFor({ timeout: 120000 });
    check(
      "Production title is exactly Verdict",
      (await page.title()) === "Verdict",
    );
    check(
      "RPC snapshot loaded",
      !!(await page.locator(".chain-health").textContent()),
    );
    check(
      "All three local font faces loaded",
      await page.evaluate(() =>
        Promise.all([...document.fonts].map((f) => f.load())).then(() =>
          [...document.fonts].every((f) => f.status === "loaded"),
        ),
      ),
    );
    await screenshot("home-desktop");
    await measureTheme("dark");
    await page
      .getByRole("link", { name: "Explore markets", exact: false })
      .first()
      .click();
    await page.getByRole("button", { name: "Finalized", exact: true }).click();
    check(
      "Status filter selects one Finalized market",
      (await page.locator(".market-card").count()) === 1 &&
        (await page.locator(".market-card").textContent()).includes("Yes"),
    );
    await page.getByRole("button", { name: "Voided", exact: true }).click();
    check(
      "Status filter selects the Voided market",
      (await page.locator(".market-card").count()) === 1 &&
        (await page.locator(".market-card").textContent()).includes("Voided"),
    );
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page
      .getByLabel("Search questions")
      .fill("no possible matching question");
    check(
      "Search empty state offers recovery",
      await page.getByRole("button", { name: "Clear filters" }).isVisible(),
    );
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Sort by").selectOption("pool");
    check(
      "Pool sort orders the 15 IMD market before 5 IMD",
      (await page.locator(".market-card").first().textContent()).includes(
        "Market #1",
      ),
    );
    await screenshot("markets-desktop");
    await page
      .locator(".market-card")
      .first()
      .getByRole("link", { name: "View market" })
      .click();
    await page
      .getByText("Hash verified", { exact: false })
      .waitFor({ timeout: 60000 });
    check(
      "Market 1 renders Final verdict Yes",
      await page.getByText("Final verdict: Yes").isVisible(),
    );
    check(
      "Panel evidence links to a UUID job",
      /\/jobs\/[0-9a-f-]{36}$/.test(
        await page
          .getByRole("link", { name: "Read the panel’s work" })
          .getAttribute("href"),
      ),
    );
    await screenshot("market-desktop");
    await page
      .getByText("Primary body · raw JSON and hash", { exact: true })
      .click();
    check(
      "Raw body disclosure shows original question JSON",
      (await page.locator("pre").first().textContent()).includes(
        '"panelSize":5',
      ),
    );
    await page.goto(url + "#/portfolio");
    check(
      "Disconnected portfolio has a connect action",
      await page
        .getByRole("button", { name: "Connect wallet", exact: false })
        .last()
        .isVisible(),
    );
    await page
      .getByRole("button", { name: "Connect wallet", exact: false })
      .last()
      .click();
    await page.getByRole("dialog").waitFor();
    check(
      "Wallet chooser explains missing injected provider",
      await page
        .getByText("No injected wallets detected.", { exact: false })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    check(
      "Escape closes wallet chooser",
      !(await page.getByRole("dialog").isVisible()),
    );
    check(
      "Wallet dialog restores focus",
      (
        await page.evaluate(() => document.activeElement?.textContent)
      )?.includes("Connect wallet"),
    );
    await page.goto(url + "#/agents");
    await page
      .getByText("Synced · block", { exact: false })
      .waitFor({ timeout: 120000 });
    await page.getByRole("table").waitFor();
    check(
      "Agent ranking groups agent ID 0 as People",
      await page
        .getByRole("rowheader", { name: "People", exact: false })
        .isVisible(),
    );
    await page.getByLabel("Rank by").selectOption("bets");
    await page.goto(url + "#/create");
    check(
      "Create page explains on-chain allowlisting",
      await page.getByText("Creators start with a wallet").isVisible(),
    );
    await page.goto(url);
    await page
      .getByText("Synced · block", { exact: false })
      .waitFor({ timeout: 120000 });
    for (const width of [390, 360, 320, 820]) {
      await page.setViewportSize({ width, height: 844 });
      check(
        `Home reflows without document overflow at ${width}px`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      if (width === 390) {
        const heading = await page.locator("h1").boundingBox(),
          action = await page
            .getByRole("link", { name: "Explore markets", exact: false })
            .first()
            .boundingBox();
        check(
          "390px first screen shows product and primary action",
          heading.y + heading.height < 844 && action.y + action.height < 844,
        );
        const marketQuestion = await page.locator(".market-card h3").first().boundingBox(),
          marketAction = await page.getByRole("link", { name: "View market", exact: false }).first().boundingBox();
        check(
          "390px first screen shows a complete actual market question and View market action",
          marketQuestion.y + marketQuestion.height <= 844 && marketAction.y + marketAction.height <= 844,
        );
        await screenshot("home-mobile");
        await page.getByRole("button", { name: "Open navigation" }).click();
        await page
          .getByRole("button", { name: "Switch to light mode" })
          .last()
          .click();
        await page.getByRole("button", { name: "Close navigation" }).click();
        await screenshot("home-mobile-light");
        await measureTheme("light");
        await page.getByRole("button", { name: "Open navigation" }).click();
        await page
          .getByRole("button", { name: "Switch to dark mode" })
          .last()
          .click();
        await page.getByRole("button", { name: "Close navigation" }).click();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + "#/market/1");
    await page
      .getByText("Hash verified", { exact: false })
      .waitFor({ timeout: 120000 });
    check(
      "Market page reflows at 390px",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await screenshot("market-mobile");
    await page.goto(url + "#/how-it-works");
    await page.getByRole("heading", { name: "Read the risks" }).waitFor();
    check(
      "Risks page reflows at 390px",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot("risks-desktop");
    await page.goto(url);
    await page.keyboard.press("Tab");
    check(
      "Keyboard reaches visible skip link",
      await page
        .getByRole("link", { name: "Skip to content" })
        .evaluate((el) => el === document.activeElement),
    );
    await page.screenshot({
      path: path.join(root, "artifacts/focus-desktop.png"),
    });
    await page.keyboard.press("Enter");
    check(
      "Skip link moves focus to main",
      await page.evaluate(() => document.activeElement.id === "main"),
    );
    check("No uncaught browser errors", errors.length === 0);
    const localFailures = failures.filter((f) => f.url.startsWith(url));
    check("No failed local asset requests", localFailures.length === 0);
    const report = {
      checkedAt: new Date().toISOString(),
      url: "/preview/",
      browser: await browser.version(),
      results,
      errors,
      requestFailures: failures,
      rendered,
    };
    fs.writeFileSync(
      path.join(root, "artifacts/browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
