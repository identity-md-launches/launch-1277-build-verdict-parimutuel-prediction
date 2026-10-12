// Bounded foreground preview + Chromium review of the production export.
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
const { chromium } = require("playwright"),
  { default: AxeBuilder } = require("@axe-core/playwright");
const root = fileURLToPath(new URL("../../", import.meta.url)),
  dist = path.join(root, "dist"),
  evidence = path.join(root, "test/scratch/browser");
fs.mkdirSync(evidence, { recursive: true });
const server = createServer((req, res) => {
  const name = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  ).replace(/^\/preview\//, "");
  const file = path.resolve(dist, name || "index.html");
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type":
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      }[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_EXECUTABLE ||
    (fs.existsSync(
      "/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome",
    )
      ? "/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome"
      : undefined),
  headless: true,
  args: ["--no-sandbox"],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(evidence, "chromium-config"),
    XDG_CACHE_HOME: path.join(evidence, "chromium-cache"),
  },
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  results = [],
  errors = [],
  failures = [],
  contrast = [],
  axe = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) =>
  failures.push({ url: r.url(), error: r.failure()?.errorText }),
);
if (process.env.VERDICT_RPC_URL)
  await context.route(
    /https:\/\/(mainnet.gateway.tenderly.co|rpc.mevblocker.io|ethereum-rpc.publicnode.com)/,
    async (route) => {
      const response = await fetch(process.env.VERDICT_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: route.request().postData(),
      });
      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: await response.text(),
      });
    },
  );
const check = (name, passed) => {
  assert.ok(passed, name);
  results.push(name);
  console.log("PASS " + name);
};
const scan = async (name) => {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  axe.push({
    name,
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  check("axe: " + name, r.violations.length === 0);
};
const lum = (color) =>
  color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
try {
  await page.goto(url);
  await page
    .getByText("Synced · block", { exact: false })
    .waitFor({ timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  const loadedFonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({
      family: f.family,
      weight: f.weight,
      status: f.status,
    })),
  );
  check(
    "Local Archivo and IBM Plex Mono fonts loaded",
    loadedFonts.some((f) => f.family === "Archivo" && f.status === "loaded") &&
      loadedFonts.some(
        (f) =>
          f.family === "IBM Plex Mono" &&
          f.weight === "400" &&
          f.status === "loaded",
      ) &&
      loadedFonts.some(
        (f) =>
          f.family === "IBM Plex Mono" &&
          f.weight === "500" &&
          f.status === "loaded",
      ),
  );
  check("Title is exactly Verdict", (await page.title()) === "Verdict");
  check(
    "Mainnet notice and no testnet banner",
    (await page.locator(".mainnet-notice").isVisible()) &&
      (await page.locator(".testnet-banner").count()) === 0,
  );
  check(
    "No runtime page mentions Sepolia",
    !(await page.locator("body").innerText()).includes("Sepolia"),
  );
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page
        .getByRole("button", { name: "Switch to light mode", exact: true })
        .first()
        .click();
    await page.evaluate(() => document.fonts.ready);
    const pairs = await page.evaluate(() => {
      const s = (q) => getComputedStyle(document.querySelector(q));
      return [
        ["body", s("body").color, s("html").backgroundColor, 4.5],
        ["muted", s(".hero-description").color, s("html").backgroundColor, 4.5],
        [
          "primary",
          s(".hero-actions .primary").color,
          s(".hero-actions .primary").backgroundColor,
          4.5,
        ],
        [
          "notice",
          s(".mainnet-notice").color,
          s(".mainnet-notice").backgroundColor,
          4.5,
        ],
      ];
    });
    for (const [name, fg, bg, min] of pairs) {
      const a = lum(fg),
        b = lum(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      contrast.push({
        theme,
        name,
        foreground: fg,
        background: bg,
        ratio: Number(ratio.toFixed(3)),
        required: min,
      });
      check(`${theme} ${name} contrast`, ratio >= min);
    }
    await scan("home " + theme);
    await page.screenshot({
      path: path.join(evidence, `home-${theme}-desktop.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .first()
    .click();
  for (const width of [1440, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    check(
      `Home reflows at ${width}px`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (width === 390) {
      const box = await page.locator(".hero-actions .primary").boundingBox();
      check(
        "390px first screen shows product and main action",
        box &&
          box.y + box.height < 844 &&
          (await page.getByRole("heading", { level: 1 }).isVisible()),
      );
      await page.screenshot({ path: path.join(evidence, "home-dark-390.png") });
      await page.reload();
      await page.getByText("Synced · block", { exact: false }).waitFor();
      await page.keyboard.press("Tab");
      check(
        "Skip link receives keyboard focus",
        await page
          .locator(".skip-link")
          .evaluate((el) => el === document.activeElement),
      );
      await page.keyboard.press("Enter");
      check(
        "Skip link moves focus to main",
        await page
          .locator("main")
          .evaluate((el) => el === document.activeElement),
      );
      await page.getByRole("button", { name: "Open navigation" }).click();
      check(
        "Mobile navigation opens",
        await page.locator("#primary-nav").isVisible(),
      );
      await page
        .getByRole("link", { name: "Markets", exact: true })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "Markets", exact: true })
        .waitFor();
      check(
        "Mobile navigation closes after selection",
        await page.locator("#primary-nav").isHidden(),
      );
      await page.goto(url);
      await page.getByText("Synced · block", { exact: false }).waitFor();
    }
  }
  for (const [route, title] of [
    ["markets", "Markets"],
    ["portfolio", "Your positions."],
    ["leaderboard", "Leaderboard"],
    ["for-agents", "Build with Verdict."],
    ["how-it-works", "A question. A public verdict."],
    ["create", "Create a market"],
  ]) {
    await page.goto(url + "#/" + route);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.getByText("Synced · block", { exact: false }).waitFor();
    for (const width of [360, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      check(
        `${route} reflows at ${width}px`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await scan(route);
    if (route === "markets") {
      await page
        .getByRole("combobox", { name: "Token", exact: true })
        .selectOption("WETH");
      await page.getByLabel("Search questions").fill("nonexistent test query");
      await page.getByRole("button", { name: "Open", exact: true }).click();
      check(
        "Token/status/search filters render empty state",
        await page
          .getByRole("heading", { name: "No markets match" })
          .isVisible(),
      );
      await page.getByRole("button", { name: "Clear filters" }).click();
      check(
        "Clear filters resets token",
        (await page
          .getByRole("combobox", { name: "Token", exact: true })
          .inputValue()) === "All",
      );
    }
    if (route === "leaderboard")
      for (const tab of ["Agents", "Creators", "Settlers", "Traders"]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await page.getByLabel("Period").selectOption("week");
        check(
          `Leaderboard ${tab} period control`,
          (await page.getByLabel("Period").inputValue()) === "week",
        );
      }
    if (route === "for-agents")
      check(
        "Three local ABI downloads",
        (await page.locator("a[download]").count()) === 3,
      );
  }
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  check(
    "Wallet modal supports Escape",
    await page.getByRole("dialog").isHidden(),
  );
  check("No uncaught browser exceptions", errors.length === 0);
  check("No failed runtime resources", failures.length === 0);
  const report = {
    checkedAt: new Date().toISOString(),
    scope: process.env.VERDICT_RPC_URL
      ? "Production export served under /preview/; live Ethereum reads relayed through the supplied loopback RPC. No signing or transactions. Public browser endpoints not independently exercised in this pass."
      : "Production export with public RPC reads",
    results,
    contrast,
    loadedFonts,
    axe,
    errors,
    failures,
    screenshots: [
      "test/scratch/browser/home-dark-desktop.png",
      "test/scratch/browser/home-light-desktop.png",
      "test/scratch/browser/home-dark-390.png",
    ],
    limitations: [
      "Automated Chromium checks are not a screen-reader or physical-device session.",
      "Native browser zoom and slow-motion replay not performed.",
    ],
  };
  fs.writeFileSync(
    path.join(root, "web/validation/browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
} catch (e) {
  await page.screenshot({
    path: path.join(evidence, "failure.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(evidence, "failure.json"),
    JSON.stringify({ message: e.message, errors, failures, axe }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
