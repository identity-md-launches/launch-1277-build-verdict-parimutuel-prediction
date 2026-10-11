// Deterministic browser contract/wallet integration checks. No request leaves the mock RPC routes.
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { DEFAULT_CHAIN, CHAINS } from "../src/config.ts";
const require = createRequire(
  process.env.VERDICT_NODE_MODULES
    ? path.join(process.env.VERDICT_NODE_MODULES, "../package.json")
    : import.meta.url,
);
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const {
  decodeFunctionData,
  decodeEventLog,
  encodeFunctionResult,
  encodeErrorResult,
  erc20Abi,
  toHex,
  parseUnits,
} = require("viem");
const root = fileURLToPath(new URL("../../", import.meta.url));
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const captured = readJSON("web/tests/wallet-rpc-fixture.json"),
  fixture = readJSON("web/tests/chain-fixture.json");
const abi = readJSON("web/src/abi/VerdictMarkets.json"),
  oracleAbi = readJSON("web/src/abi/VerdictOracle.json");
const d = DEFAULT_CHAIN.deployment,
  account = fixture.markets[0].market.creator;
const baseMarkets = fixture.markets.map((x) => {
  const m = structuredClone(x.market);
  for (const k of [
    "lastPrimaryAsk",
    "disputeEnds",
    "pool",
    "bountyRemaining",
    "oracleSpend",
    "fees",
    "returnedBounty",
    "paidOut",
    "refunded",
    "remainingPayout",
    "remainingWinningStake",
    "escalationAskedAt",
  ])
    m[k] = BigInt(m[k]);
  for (const k of [
    "dataChainId",
    "fromBlock",
    "toBlock",
    "closeAt",
    "answerFrom",
    "answerUntil",
    "voidAfter",
    "bounty",
  ])
    m.params[k] = BigInt(m.params[k]);
  m.params.bounds = m.params.bounds.map(BigInt);
  return m;
});
let mockHead = BigInt(captured.block.number);
let scenario = "open",
  allowance = 0n,
  allowed = true,
  failPrimary = true,
  sent = [],
  selectedChain = CHAINS[1].chainId,
  denied = false;
const requests = [],
  methods = [];
const pools = [
  [parseUnits("5", 18), parseUnits("10", 18)],
  [parseUnits("5", 18), 0n],
];
function market(index) {
  const m = structuredClone(baseMarkets[index]);
  if (scenario === "open" && index === 0) {
    m.status = 0;
    m.params.closeAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
    m.params.answerFrom = m.params.closeAt;
    m.params.answerUntil = m.params.closeAt + 86400n;
    m.params.voidAfter = m.params.closeAt + 172800n;
    m.paidOut = 0n;
    m.fees = 0n;
    m.asks = 0;
    m.remainingPayout = 0n;
    m.remainingWinningStake = 0n;
  }
  if (scenario === "portfolio") {
    m.paidOut = 0n;
    m.refunded = 0n;
    if (index === 0) {
      m.remainingPayout = parseUnits("14.7", 18);
      m.remainingWinningStake = parseUnits("10", 18);
    }
  }
  if (
    ["closed", "answered", "provisional", "finalizable"].includes(scenario) &&
    index === 0
  ) {
    m.status = ["provisional", "finalizable"].includes(scenario) ? 1 : 0;
    m.disputeEnds = BigInt(
      Math.floor(Date.now() / 1000) + (scenario === "provisional" ? 3600 : -60),
    );
  }
  if (scenario === "voidable" && index === 1) m.status = 0;
  return m;
}
function rpcError(name) {
  return {
    error: {
      code: 3,
      message: `execution reverted: ${name}`,
      data: encodeErrorResult({ abi, errorName: name }),
    },
  };
}
function resolveRpc(payload) {
  const { method, params = [] } = payload;
  requests.push({ method, params });
  if (method === "eth_chainId") return { result: toHex(DEFAULT_CHAIN.chainId) };
  if (method === "eth_blockNumber") return { result: toHex(mockHead) };
  if (method === "eth_getCode")
    return { result: captured.codes[params[0].toLowerCase()] };
  if (method === "eth_getBlockByNumber")
    return {
      result: {
        ...captured.block,
        number: toHex(mockHead),
        timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))),
      },
    };
  if (method === "eth_getTransactionReceipt")
    return { result: captured.receipt };
  if (method === "eth_getTransactionByHash")
    return { result: captured.transaction };
  if (method === "eth_getLogs") {
    const [filter] = params;
    assert.ok(
      BigInt(filter.toBlock) - BigInt(filter.fromBlock) < 10000n,
      "Log chunks respect 10,000-block cap",
    );
    let logs = captured.logs;
    if (["open", "closed"].includes(scenario))
      logs = logs.filter((log) => {
        try {
          const e = decodeEventLog({
            abi: log.address.toLowerCase() === d.oracle ? oracleAbi : abi,
            data: log.data,
            topics: log.topics,
          });
          return (
            log.address.toLowerCase() !== d.oracle &&
            !(
              e.args.id === 1n &&
              [
                "OracleAsked",
                "OutcomeProposed",
                "Finalized",
                "Claimed",
                "BountyReturned",
              ].includes(e.eventName)
            )
          );
        } catch {
          return true;
        }
      });
    if (
      ["answered", "provisional", "finalizable", "voidable"].includes(scenario)
    ) {
      logs = logs.filter((log) => {
        const e = decodeEventLog({
          abi: log.address.toLowerCase() === d.oracle ? oracleAbi : abi,
          data: log.data,
          topics: log.topics,
        });
        if (e.args.id === 1n && scenario !== "voidable")
          return ![
            "Finalized",
            "Claimed",
            "BountyReturned",
            ...(scenario === "answered" ? ["OutcomeProposed"] : []),
          ].includes(e.eventName);
        if (e.args.id === 2n && scenario === "voidable")
          return !["Voided", "Claimed", "BountyReturned"].includes(e.eventName);
        return true;
      });
    }
    return {
      result: logs.filter(
        (l) =>
          BigInt(l.blockNumber) >= BigInt(filter.fromBlock) &&
          BigInt(l.blockNumber) <= BigInt(filter.toBlock),
      ),
    };
  }
  if (method === "eth_call") {
    const tx = params[0],
      target = tx.to.toLowerCase();
    let contractAbi =
      target === d.token ? erc20Abi : target === d.oracle ? oracleAbi : abi;
    const { functionName: name, args = [] } = decodeFunctionData({
      abi: contractAbi,
      data: tx.data,
    });
    let value;
    if (target === d.token) {
      if (name === "balanceOf")
        value =
          args[0].toLowerCase() === d.burnVault
            ? parseUnits(".075", 18)
            : parseUnits("100", 18);
      if (name === "allowance") value = allowance;
      if (name === "approve") value = true;
    } else if (target === d.oracle) {
      if (name === "price") value = parseUnits(".5", 18);
    } else {
      const id = Number(args[0] || 1n) - 1;
      if (name === "getMarket") value = market(id);
      else if (name === "outcomePool") value = pools[id][Number(args[1])];
      else if (name === "maxPoolPerMarket") value = parseUnits("500", 18);
      else if (name === "paused") value = false;
      else if (name === "allowlistOn") value = true;
      else if (name === "allowedCreators") value = allowed;
      else if (name === "marketCount") value = 2n;
      else if (name === "totalStake")
        value = id === 0 ? parseUnits("15", 18) : parseUnits("5", 18);
      else if (name === "stakes") value = pools[id][Number(args[2])];
      else if (name === "claimed") value = scenario !== "portfolio";
      else if (name === "bet") {
        if (scenario !== "open") return rpcError("OutsideWindow");
        if (allowance < BigInt(args[2])) return rpcError("InvalidAmount");
        value = undefined;
      } else if (name === "createMarket") {
        if (!allowed) return rpcError("CreatorNotAllowed");
        if (allowance < BigInt(args[0].bounty))
          return rpcError("InsufficientBounty");
        value = 3n;
      } else if (name === "claim") {
        if (scenario !== "portfolio") return rpcError("NothingToClaim");
        value = id === 0 ? parseUnits("14.7", 18) : parseUnits("5", 18);
      } else if (
        (name === "resolve" && scenario === "closed") ||
        (name === "escalate" && scenario === "provisional")
      ) {
        value = baseMarkets[0].primaryRequests[0];
      } else if (
        (name === "propose" && scenario === "answered") ||
        (name === "finalize" && scenario === "finalizable") ||
        (name === "voidMarket" && scenario === "voidable")
      ) {
        value = undefined;
      } else return rpcError("WrongState");
    }
    return {
      result: encodeFunctionResult({
        abi: contractAbi,
        functionName: name,
        result: value,
      }),
    };
  }
  throw Error("Unhandled mock RPC method: " + method);
}
const server = createServer((req, res) => {
  const relative = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  ).replace(/^\/preview\//, "");
  const file = path.resolve(root, "dist", relative || "index.html");
  if (
    !file.startsWith(path.join(root, "dist") + path.sep) ||
    !fs.existsSync(file)
  ) {
    res.writeHead(404).end();
    return;
  }
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  res.writeHead(200, {
    "Content-Type": mime[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
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
const results = [],
  errors = [],
  axeResults = [];
const check = (label, value) => {
  assert.ok(value, label);
  results.push(label);
  console.log("PASS " + label);
};
page.on("pageerror", (e) => errors.push(e.message));
await context.route(/https:\/\//, async (route) => {
  if (
    failPrimary &&
    route.request().url().startsWith(DEFAULT_CHAIN.rpcUrls[0])
  ) {
    methods.push("primary failed, fallback required");
    await route.abort("failed");
    return;
  }
  const payload = route.request().postDataJSON();
  if (!payload?.method)
    throw Error("Unexpected external request: " + route.request().url());
  methods.push(route.request().url());
  if (route.request().url().startsWith(DEFAULT_CHAIN.rpcUrls[1]))
    failPrimary = false;
  try {
    const response = resolveRpc(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: payload.id, ...response }),
    });
  } catch (e) {
    console.error(e);
    throw e;
  }
});
await context.exposeBinding("mockWalletRequest", async (_, request) => {
  methods.push(request.method);
  if (
    request.method === "eth_requestAccounts" ||
    request.method === "eth_accounts"
  )
    return [account];
  if (request.method === "eth_chainId") return toHex(selectedChain);
  if (request.method === "wallet_switchEthereumChain") {
    selectedChain = Number(request.params[0].chainId);
    return null;
  }
  if (request.method === "eth_sendTransaction") {
    if (denied)
      throw Object.assign(Error("User rejected the transaction."), {
        code: 4001,
      });
    const tx = request.params[0];
    sent.push(tx);
    mockHead++;
    const decoded = decodeFunctionData({
      abi: tx.to.toLowerCase() === d.token ? erc20Abi : abi,
      data: tx.data,
    });
    if (decoded.functionName === "approve") allowance = decoded.args[1];
    if (decoded.functionName === "bet") allowance -= decoded.args[2];
    if (decoded.functionName === "createMarket")
      allowance -= decoded.args[0].bounty;
    return captured.receipt.transactionHash;
  }
  throw Error("Unhandled wallet request: " + request.method);
});
await context.addInitScript(() => {
  const callbacks = {};
  const provider = {
    request: async (request) => await window.mockWalletRequest(request),
    on: (event, fn) => {
      (callbacks[event] ||= []).push(fn);
    },
    removeListener: (event, fn) => {
      callbacks[event] = (callbacks[event] || []).filter((f) => f !== fn);
    },
  };
  window.emitWalletEvent = (name, value) =>
    (callbacks[name] || []).forEach((fn) => fn(value));
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "verdict-browser-test-wallet",
            name: "Browser test wallet",
            icon: "",
            rdns: "local.test",
          },
          provider,
        },
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});
const connect = async () => {
  if (await page.locator(".wallet-menu summary").isVisible()) return;
  await page
    .getByRole("button", { name: "Connect wallet", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Browser test wallet" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
};
const scanAxe = async (label) => {
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  axeResults.push({
    label,
    violations: scan.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        failureSummary: n.failureSummary,
      })),
    })),
  });
  check(`Automated accessibility scan: ${label}`, scan.violations.length === 0);
};
try {
  await page.goto(url + "#/market/1");
  await page.getByText("Take a position", { exact: true }).waitFor();
  check(
    "RPC fallback recovers after the primary endpoint fails",
    methods.some((m) => m.startsWith(DEFAULT_CHAIN.rpcUrls[1])),
  );
  await connect();
  await page.getByLabel("Amount · test IMD", { exact: true }).fill("2.5");
  await page
    .getByRole("button", { name: "Approve exact amount & bet" })
    .click();
  await page
    .getByText("Transaction confirmed. Chain data refreshed.", { exact: true })
    .waitFor();
  check(
    "Wallet switches from the data chain to the configured market chain",
    selectedChain === DEFAULT_CHAIN.chainId &&
      methods.includes("wallet_switchEthereumChain"),
  );
  check("Bet flow sends approval followed by bet", sent.length === 2);
  const approve = decodeFunctionData({ abi: erc20Abi, data: sent[0].data });
  const bet = decodeFunctionData({ abi, data: sent[1].data });
  check(
    "Approval is the exact amount to VerdictMarkets",
    approve.functionName === "approve" &&
      approve.args[0].toLowerCase() === d.markets &&
      approve.args[1] === parseUnits("2.5", 18),
  );
  check(
    "Bet encodes id, selected outcome, amount and person agentId 0",
    bet.functionName === "bet" &&
      bet.args[0] === 1n &&
      bet.args[1] === 1 &&
      bet.args[2] === parseUnits("2.5", 18) &&
      bet.args[3] === 0n,
  );
  check(
    "Permissionless controls show simulation rejection reasons",
    await page
      .getByText("The market is not in a state that accepts this action.", {
        exact: false,
      })
      .first()
      .isVisible(),
  );
  check(
    "Rejected settlement action is disabled",
    await page
      .getByRole("button", { name: "Finalize", exact: true })
      .isDisabled(),
  );
  await scanAxe("open market, connected wallet, dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, "artifacts/bet-mobile.png"),
    fullPage: true,
  });
  check(
    "Open market with bet controls has no mobile overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByLabel("Amount · test IMD", { exact: true }).fill("501");
  await page
    .getByRole("button", { name: "Approve exact amount & bet" })
    .click();
  check(
    "Oversized bet is blocked before wallet submission",
    sent.length === 2 &&
      (await page
        .getByText("This amount exceeds the remaining pool capacity.", {
          exact: true,
        })
        .isVisible()),
  );
  await page.getByLabel("Amount · test IMD", { exact: true }).fill("1");
  denied = true;
  await page
    .getByRole("button", { name: /Place bet|Approve exact amount & bet/ })
    .click();
  await page
    .getByText("User rejected the transaction.", { exact: false })
    .first()
    .waitFor();
  denied = false;
  check(
    "Wallet rejection is recoverable without a send",
    sent.length === 2 &&
      (await page
        .getByRole("button", { name: /Place bet|Approve exact amount & bet/ })
        .isEnabled()),
  );
  await page
    .getByRole("button", { name: "Dismiss transaction message" })
    .click();
  check(
    "A rejected transaction notice can be dismissed",
    (await page.locator(".transaction-notice").count()) === 0,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url + "#/create");
  await connect();
  await page.getByRole("heading", { name: "1. The question" }).waitFor();
  await page
    .getByRole("button", { name: "Review market", exact: false })
    .click();
  check(
    "Create validation focuses the missing question",
    await page
      .locator("#create-question")
      .evaluate((el) => el === document.activeElement),
  );
  await page
    .getByLabel("Question", { exact: true })
    .fill(
      "Will the measured value exceed the threshold in the specified window?",
    );
  await page.getByLabel("First block", { exact: true }).fill("1");
  await page.getByLabel("Last block", { exact: true }).fill("100");
  await page
    .getByText("The first evidence block is not after", { exact: false })
    .waitFor();
  check(
    "Evidence window warns when known before close",
    await page
      .getByText("The first evidence block is not after", { exact: false })
      .isVisible(),
  );
  await page.getByLabel("Answer type").selectOption("uint256");
  await page.getByLabel("Bucket bounds · 18-decimal units").fill("1, 2.5");
  await page
    .getByRole("button", { name: "Review market", exact: false })
    .click();
  await page
    .getByRole("heading", { name: "Review your market", exact: true })
    .waitFor();
  check(
    "Create review renders 18-decimal bucket labels",
    await page
      .getByText("Below 1 · 1 to under 2.5 · 2.5 and above", { exact: true })
      .isVisible(),
  );
  await scanAxe("creator review, desktop, dark");
  await page.screenshot({
    path: path.join(root, "artifacts/create-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    "Creator form reflows at 390px",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(root, "artifacts/create-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Approve bounty & create market" })
    .click();
  await page
    .getByRole("heading", { name: "Every question. On chain." })
    .waitFor();
  const created = decodeFunctionData({ abi, data: sent.at(-1).data });
  check(
    "Create sends the reviewed params and compact primary/escalation bodies",
    created.functionName === "createMarket" &&
      created.args[0].bounds[1] === parseUnits("2.5", 18) &&
      created.args[1].startsWith("0x7b"),
  );
  const bountyApproval = decodeFunctionData({
    abi: erc20Abi,
    data: sent.at(-2).data,
  });
  check(
    "Creator approves exactly the reviewed bounty",
    bountyApproval.functionName === "approve" &&
      bountyApproval.args[1] === created.args[0].bounty,
  );
  // A new connection to a disallowed wallet must not reveal creator controls.
  allowed = false;
  await page.goto(url + "#/create");
  await connect();
  await page
    .getByText("This wallet isn’t an approved creator", { exact: true })
    .waitFor();
  check(
    "On-chain creator allowlist gates the builder",
    (await page.locator("#create-question").count()) === 0,
  );
  scenario = "portfolio";
  allowed = true;
  await page.goto(url + "#/portfolio");
  await page.reload();
  await connect();
  await page.getByRole("heading", { name: "Positions", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Claim winnings", exact: true })
    .waitFor();
  check(
    "Portfolio reads stakes, totalStake and claimed, showing both positions",
    (await page.locator(".position").count()) === 2,
  );
  check(
    "Unclaimed finalized winnings and voided refunds are actionable",
    (await page
      .getByRole("button", { name: "Claim winnings", exact: true })
      .isEnabled()) &&
      (await page
        .getByRole("button", { name: "Claim refund", exact: true })
        .isEnabled()),
  );
  await page.getByRole("button", { name: "Claim refund", exact: true }).click();
  await page
    .getByText("Transaction confirmed. Chain data refreshed.", { exact: true })
    .waitFor();
  const claim = decodeFunctionData({ abi, data: sent.at(-1).data });
  check(
    "Refund claim sends claim(market 2)",
    claim.functionName === "claim" && claim.args[0] === 2n,
  );
  await scanAxe("portfolio, mobile, dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .first()
    .click();
  await scanAxe("portfolio, desktop, light");
  await page.goto(url + "#/");
  await page.getByText("Synced · block", { exact: false }).waitFor();
  await scanAxe("home, light");
  await page.goto(url + "#/how-it-works");
  await scanAxe("risks, light");
  await page.goto(url + "#/agents");
  await page.getByRole("table").waitFor();
  await scanAxe("agent ranking, light");
  for (const [state, label, fn, id] of [
    ["closed", "Request answer", "resolve", 1n],
    ["answered", "Submit answer", "propose", 1n],
    ["provisional", "Escalate", "escalate", 1n],
    ["finalizable", "Finalize", "finalize", 1n],
    ["voidable", "Refund", "voidMarket", 2n],
  ]) {
    scenario = state;
    await page.goto(url + "#/market/" + id);
    await page.reload();
    await connect();
    const action = page.getByRole("button", { name: label, exact: true });
    await action.waitFor();
    await page.waitForFunction(
      (text) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.includes(text) && !b.disabled,
        ),
      label,
    );
    await action.click();
    await page
      .getByText("Transaction confirmed. Chain data refreshed.", {
        exact: true,
      })
      .waitFor();
    const decoded = decodeFunctionData({ abi, data: sent.at(-1).data });
    check(
      label + " sends the simulated settlement call",
      decoded.functionName === fn && decoded.args[0] === id,
    );
    const creation = captured.logs
      .map((log) =>
        decodeEventLog({
          abi: log.address.toLowerCase() === d.oracle ? oracleAbi : abi,
          data: log.data,
          topics: log.topics,
        }),
      )
      .find((e) => e.eventName === "MarketCreated" && e.args.id === 1n);
    if (fn === "resolve" || fn === "escalate")
      check(
        label + " uses the original MarketCreated bytes",
        decoded.args[1] ===
          creation.args[fn === "resolve" ? "body" : "escalationBody"],
      );
    if (fn === "propose")
      check(
        "Submit answer sends the recovered on-chain attestation",
        decoded.args[1].questionHash === baseMarkets[0].params.questionHash &&
          decoded.args[1].panelSize === 5,
      );
  }
  check(
    "No uncaught browser errors in mocked wallet flows",
    errors.length === 0,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    scope:
      "Deterministic mocked RPC and EIP-6963 wallet; no live transactions broadcast",
    results,
    axeResults,
    errors,
    transactionCount: sent.length,
    requests: requests.length,
  };
  fs.writeFileSync(
    path.join(root, "artifacts/wallet-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  fs.writeFileSync(
    "/tmp/verdict-wallet-failure.json",
    JSON.stringify(
      { message: e.message, results, axeResults, errors },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "/tmp/verdict-wallet-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
