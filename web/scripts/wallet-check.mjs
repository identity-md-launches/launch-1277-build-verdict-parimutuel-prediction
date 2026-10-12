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
const { mainnet } = require("viem/chains");
const { default: AxeBuilder } = require("@axe-core/playwright");
const {
  decodeFunctionData,
  decodeEventLog,
  encodeFunctionResult,
  encodeFunctionData,
  decodeAbiParameters,
  encodeErrorResult,
  erc20Abi,
  toHex,
  parseUnits,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbi,
} = require("viem");
const root = fileURLToPath(new URL("../../", import.meta.url));
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const captured = readJSON("web/tests/wallet-rpc-fixture.json"),
  fixture = readJSON("web/tests/chain-fixture.json");
const abi = readJSON("web/src/abi/VerdictMarkets.json"),
  oracleAbi = readJSON("web/src/abi/VerdictOracle.json");
const d = DEFAULT_CHAIN.deployment,
  account = fixture.markets[0].market.creator;
const runtime = readJSON("web/tests/mainnet-runtime.json");
const legacyAbi = readJSON("web/tests/legacy-markets-abi.json");
const wethAbi = [
  ...erc20Abi,
  ...parseAbi(["function deposit() payable", "function withdraw(uint256 wad)"]),
];
const ensAbi = parseAbi([
  "function reverseWithGateways(bytes reverseName, uint256 coinType, string[] gateways) view returns (string resolvedName, address resolver, address reverseResolver)",
  "function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes result, address resolver)",
]);
const oldOracle = "0xf9e8362469be9944e7e79732bcea9bcecb4ae25d";
const blockShift = d.block - 11888875n;
captured.codes = Object.fromEntries(
  Object.entries(runtime.codes).map(([key, code]) => [
    d[key].toLowerCase(),
    code,
  ]),
);
captured.logs = captured.logs.map((log) => {
  const isOracle = log.address.toLowerCase() === oldOracle;
  const old = decodeEventLog({
    abi: isOracle ? oracleAbi : legacyAbi,
    data: log.data,
    topics: log.topics,
  });
  const event = (isOracle ? oracleAbi : abi).find(
    (e) => e.type === "event" && e.name === old.eventName,
  );
  const args = { ...old.args };
  if (old.eventName === "MarketCreated") {
    args.collateral = args.id === 2n ? d.weth : d.token;
    args.uri = JSON.stringify({
      title:
        args.id === 1n ? "Ethereum oracle test market" : "WETH refund market",
    });
  }
  return {
    ...log,
    address: isOracle ? d.oracle : d.markets,
    blockNumber: toHex(BigInt(log.blockNumber) + blockShift),
    topics: encodeEventTopics({ abi: [event], eventName: old.eventName, args }),
    data: encodeAbiParameters(
      event.inputs.filter((i) => !i.indexed),
      event.inputs.filter((i) => !i.indexed).map((i) => args[i.name]),
    ),
  };
});
captured.receipt = {
  ...captured.receipt,
  logs: captured.receipt.logs.map((l) => ({
    ...l,
    address: l.address.toLowerCase() === oldOracle ? d.oracle : l.address,
  })),
};
captured.transaction = { ...captured.transaction, to: d.intake };
let wethMode = false,
  wethBalance = 0n;
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
  m.params.settlerReward = parseUnits("0.05", 18);
  m.params.collateralId = Number(x.id) === 2 ? 1 : 0;
  m.settlerReward = m.params.settlerReward;
  m.rewardsPaid = parseUnits("0.15", 18);
  m.collateral = m.params.collateralId === 1 ? d.weth : d.token;
  m.bountyToken = d.token;
  return m;
});
let mockHead = d.block + 2000n;
const reviewMode = process.argv.includes("--review") || process.argv.includes("--review-before");
let scenario = "open",
  allowance = 0n,
  allowed = true,
  failPrimary = true,
  sent = [],
  selectedChain = 10,
  denied = false,
  failTransaction = false,
  failAccess = false;
const requests = [],
  methods = [];
const pools = [
  [parseUnits("5", 18), parseUnits("10", 18)],
  [parseUnits("5", 18), 0n],
];
function market(index) {
  const m = structuredClone(baseMarkets[index > 1 ? 0 : index]);
  if (scenario === "settlers-zero") {
    m.params.settlerReward = m.settlerReward = m.rewardsPaid = 0n;
  }
  if (index === 0 && wethMode) {
    m.params.collateralId = 1;
    m.collateral = d.weth;
    m.pool = 0n;
  }
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
// Mainnet-shaped zero-reward lifecycle fixture. These synthetic transaction
// envelopes are used only by the review regression mode and never broadcast.
function settlementTransaction(hash) {
  const log = captured.logs.find((l) => {
    if (l.transactionHash !== hash || l.address !== d.markets) return false;
    return ["OracleAsked", "OutcomeProposed", "Finalized", "Voided"].includes(
      decodeEventLog({ abi, data: l.data, topics: l.topics }).eventName,
    );
  });
  if (!log) return captured.transaction;
  const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
  const functionName = { OracleAsked: "resolve", OutcomeProposed: "propose", Finalized: "finalize", Voided: "voidMarket" }[e.eventName];
  const args = [e.args.id];
  if (functionName === "resolve") {
    const creation = captured.logs.map((l) => decodeEventLog({
      abi: l.address === d.markets ? abi : oracleAbi, data: l.data, topics: l.topics,
    })).find((l) => l.eventName === "MarketCreated" && l.args.id === e.args.id);
    args.push(creation.args.body);
  }
  if (functionName === "propose") {
    const call = decodeFunctionData({
      abi: parseAbi(["function complete(bytes32,uint8,bytes32,string,bytes)"]),
      data: captured.transaction.input,
    });
    const attestation = abi.find((a) => a.type === "function" && a.name === "propose").inputs[1];
    args.push(decodeAbiParameters([{ type: "bytes32" }, attestation, { type: "bytes" }], call.args[4])[1]);
  }
  return {
    ...captured.transaction, hash, blockNumber: log.blockNumber,
    to: d.markets, from: e.args.id === 1n ? account : captured.transaction.from,
    input: encodeFunctionData({ abi, functionName, args }),
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
        timestamp: toHex(
          BigInt(Math.floor(Date.now() / 1000)) -
            (params[0] === "latest" ? 0n : mockHead - BigInt(params[0])) * 12n,
        ),
      },
    };
  if (method === "eth_getTransactionReceipt")
    return { result: captured.receipt };
  if (method === "eth_getTransactionByHash")
    return failTransaction
      ? {
          error: {
            code: -32603,
            message: "temporary transaction lookup unavailable",
          },
        }
      : { result: reviewMode ? settlementTransaction(params[0]) : captured.transaction };
  if (method === "eth_getLogs") {
    const [filter] = params;
    assert.ok(
      BigInt(filter.toBlock) - BigInt(filter.fromBlock) < 5000n,
      "Log chunks respect 5,000-block cap",
    );
    let logs = [...captured.logs];
    if (scenario === "leaderboard") {
      for (const id of [3n, 4n]) {
        for (const log of captured.logs.filter(
          (l) => l.address === d.markets,
        )) {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.args.id !== 1n) continue;
          const event = abi.find(
              (e) => e.type === "event" && e.name === decoded.eventName,
            ),
            args = { ...decoded.args, id };
          logs.push({
            ...log,
            logIndex: toHex(Number(log.logIndex) + Number(id) * 100),
            topics: encodeEventTopics({
              abi: [event],
              eventName: event.name,
              args,
            }),
            data: encodeAbiParameters(
              event.inputs.filter((i) => !i.indexed),
              event.inputs.filter((i) => !i.indexed).map((i) => args[i.name]),
            ),
          });
        }
      }
      const event = abi.find(
          (e) => e.type === "event" && e.name === "SettlerRewarded",
        ),
        args = {
          id: 3n,
          settler: account,
          action: 2,
          amount: parseUnits(".05", 18),
        };
      logs.push({
        ...logs[0],
        address: d.markets,
        logIndex: "0xffff",
        topics: encodeEventTopics({
          abi: [event],
          eventName: event.name,
          args,
        }),
        data: encodeAbiParameters(
          event.inputs.filter((i) => !i.indexed),
          event.inputs.filter((i) => !i.indexed).map((i) => args[i.name]),
        ),
      });
    }
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
    if (target === mainnet.contracts.ensUniversalResolver.address) {
      const call = decodeFunctionData({ abi: ensAbi, data: tx.data });
      return {
        result: encodeFunctionResult({
          abi: ensAbi,
          functionName: call.functionName,
          result:
            call.functionName === "reverseWithGateways"
              ? ["verdict-fixture.eth", account, account]
              : [
                  encodeAbiParameters([{ type: "address" }], [account]),
                  account,
                ],
        }),
      };
    }
    let contractAbi =
      target === d.token
        ? erc20Abi
        : target === d.weth
          ? wethAbi
          : target === d.oracle
            ? oracleAbi
            : abi;
    const { functionName: name, args = [] } = decodeFunctionData({
      abi: contractAbi,
      data: tx.data,
    });
    let value;
    if (target === d.weth) {
      if (name === "balanceOf") value = wethBalance;
      else if (name === "allowance") value = allowance;
      else if (name === "approve") value = true;
      else if (name === "deposit" || name === "withdraw") value = undefined;
    } else if (target === d.token) {
      if (name === "balanceOf")
        value =
          args[0].toLowerCase() === d.burnVault
            ? parseUnits(".075", 18)
            : parseUnits("100", 18);
      if (name === "allowance") value = allowance;
      if (name === "approve") value = true;
    } else if (target === d.oracle) {
      if (name === "price") value = parseUnits(".5", 18);
      if (name === "asset") value = d.token;
    } else {
      const id = Number(args[0] || 1n) - 1;
      if (name === "getMarket") value = market(id);
      else if (name === "outcomePool")
        value =
          wethMode && id === 0 ? 0n : pools[id > 1 ? 0 : id][Number(args[1])];
      else if (name === "maxSettlerReward") value = parseUnits(".25", 18);
      else if (name === "collateralConfig")
        value = {
          token: args[0] ? d.weth : d.token,
          creatorFeeBps: 150,
          burnFeeBps: args[0] ? 0 : 50,
          treasuryFeeBps: args[0] ? 100 : 50,
          maxPoolPerMarket: parseUnits(args[0] ? "1" : "500", 18),
        };
      else if (name === "maxPoolPerMarket") value = parseUnits("500", 18);
      else if (name === "paused") value = false;
      else if (name === "allowlistOn") value = true;
      else if (name === "allowedCreators") {
        if (failAccess)
          return {
            error: {
              code: -32603,
              message: "temporary allowlist lookup unavailable",
            },
          };
        value = allowed;
      } else if (name === "marketCount")
        value = scenario === "leaderboard" ? 4n : 2n;
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
  executablePath:
    process.env.CHROMIUM_EXECUTABLE ||
    (fs.existsSync(
      "/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome",
    )
      ? "/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome"
      : undefined),
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "test/scratch/wallet-config"),
    XDG_CACHE_HOME: path.join(root, "test/scratch/wallet-cache"),
  },
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  timezoneId: "America/Los_Angeles",
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
      abi:
        tx.to.toLowerCase() === d.token
          ? erc20Abi
          : tx.to.toLowerCase() === d.weth
            ? wethAbi
            : abi,
      data: tx.data,
    });
    if (decoded.functionName === "approve") allowance = decoded.args[1];
    if (decoded.functionName === "deposit") wethBalance += BigInt(tx.value);
    if (decoded.functionName === "withdraw") wethBalance -= decoded.args[0];
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
const confirmed = () =>
  page
    .getByText("Transaction confirmed. Chain data refreshed.", { exact: true })
    .first()
    .waitFor();
const change = async (state, route = "market/1") => {
  scenario = state;
  await page.goto(url + "#/" + route);
  await page.reload();
  await connect();
  await page.getByText("Synced · block", { exact: false }).waitFor();
};
const shot = async (name) => {
  fs.mkdirSync(path.join(root, "test/scratch/browser"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "test/scratch/browser", name + ".png"),
    fullPage: true,
  });
};
try {
  if (reviewMode) {
    const { reviewRegressions } = await import("./review-regressions.mjs");
    await reviewRegressions({
      page, url, root, check, scanAxe, shot, errors, results, axeResults, requests,
      before: process.argv.includes("--review-before"),
      configure: (options) => {
        if (options.scenario !== undefined) scenario = options.scenario;
        if (options.failTransaction !== undefined) failTransaction = options.failTransaction;
      },
    });
  } else {
  await page.goto(url + "#/market/1");
  await page.getByRole("heading", { name: "Take a position" }).waitFor();
  await connect();
  check(
    "Ordered RPC fallback recovers primary failure",
    methods.some((m) => m.startsWith(DEFAULT_CHAIN.rpcUrls[1])),
  );
  await page.getByLabel("Amount · IMD", { exact: true }).fill("2.5");
  await page
    .getByRole("button", { name: "Approve exact amount & bet" })
    .click();
  await confirmed();
  check(
    "Wallet switches to Ethereum mainnet",
    selectedChain === 1 && methods.includes("wallet_switchEthereumChain"),
  );
  const approval = decodeFunctionData({ abi: erc20Abi, data: sent[0].data }),
    bet = decodeFunctionData({ abi, data: sent[1].data });
  check(
    "IMD bet approves exact token amount",
    sent[0].to.toLowerCase() === d.token &&
      approval.args[0].toLowerCase() === d.markets &&
      approval.args[1] === parseUnits("2.5", 18),
  );
  check(
    "Bet sends id, outcome, amount and agentId 0",
    bet.functionName === "bet" &&
      bet.args[0] === 1n &&
      bet.args[1] === 1 &&
      bet.args[2] === parseUnits("2.5", 18) &&
      bet.args[3] === 0n,
  );
  check(
    "Rejected settlement action stays disabled with reason",
    (await page.getByRole("button", { name: /^Finalize/ }).isDisabled()) &&
      (await page
        .getByText("The market is not in a state that accepts this action.", {
          exact: false,
        })
        .first()
        .isVisible()),
  );
  check(
    "Reward estimate appears on four permissionless actions",
    (await page.locator(".reward-label").count()) === 4,
  );
  check(
    "Market renders UTC first in a non-UTC browser timezone",
    (await page.locator("time").first().innerText()).endsWith(" UTC") &&
      !(await page.locator("time").first().getAttribute("title")).includes(
        "UTC",
      ),
  );
  await scanAxe("IMD open market / connected / dark");
  await page.setViewportSize({ width: 360, height: 844 });
  await shot("market-imd-360");
  check(
    "Bet panel has no 360px overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByLabel("Amount · IMD", { exact: true }).fill("501");
  await page.getByRole("button", { name: /Place bet|Approve exact/ }).click();
  check(
    "Pool cap prevents transaction submission",
    sent.length === 2 &&
      (await page
        .getByText("This amount exceeds the remaining pool capacity.", {
          exact: true,
        })
        .isVisible()),
  );
  await page.getByLabel("Amount · IMD", { exact: true }).fill("1");
  denied = true;
  await page.getByRole("button", { name: /Place bet|Approve exact/ }).click();
  await page
    .getByText("User rejected the transaction.", { exact: false })
    .first()
    .waitFor();
  denied = false;
  check(
    "Wallet rejection is recoverable",
    sent.length === 2 &&
      (await page
        .getByRole("button", { name: /Place bet|Approve exact/ })
        .isEnabled()),
  );
  wethMode = true;
  allowance = 0n;
  await change("open");
  await page.getByLabel("Amount · WETH", { exact: true }).fill("0.01");
  await page.getByRole("button", { name: "Wrap ETH", exact: true }).waitFor();
  check(
    "Insufficient WETH offers wrapping first",
    await page
      .getByRole("button", { name: /Place bet|Approve exact/ })
      .isDisabled(),
  );
  await page.getByRole("button", { name: "Wrap ETH", exact: true }).click();
  await confirmed();
  check(
    "Wrap sends exact shortfall to WETH9.deposit",
    sent.at(-1).to.toLowerCase() === d.weth &&
      BigInt(sent.at(-1).value) === parseUnits(".01", 18) &&
      decodeFunctionData({ abi: wethAbi, data: sent.at(-1).data })
        .functionName === "deposit",
  );
  await page
    .getByRole("button", { name: "Approve exact amount & bet" })
    .click();
  await confirmed();
  check(
    "WETH bet approves WETH, not IMD",
    sent.at(-2).to.toLowerCase() === d.weth &&
      decodeFunctionData({ abi: erc20Abi, data: sent.at(-2).data }).args[1] ===
        parseUnits(".01", 18),
  );
  await shot("market-weth-360");
  wethMode = false;
  await change("open", "create");
  await page.getByRole("heading", { name: "1. The question" }).waitFor();
  await page.getByRole("button", { name: "Review market" }).click();
  check(
    "Create error focuses missing question",
    await page
      .locator("#create-question")
      .evaluate((el) => el === document.activeElement),
  );
  await page
    .getByLabel("Question", { exact: true })
    .fill("Will the measured value exceed the threshold?");
  await page
    .getByLabel("Market title", { exact: false })
    .fill("Test market title");
  const targetDate = new Date(Date.now() + 3 * 86400000);
  targetDate.setUTCHours(22, 0, 0, 0);
  const targetDay = targetDate.toISOString().slice(0, 10);
  await page
    .getByLabel("Question time T · UTC", { exact: false })
    .fill(targetDay + "T22:00");
  check(
    "Create default schedule is UTC independent of local timezone",
    (await page.locator("#create-closeAt").inputValue()) ===
      targetDay + "T20:00" &&
      (await page.locator("#create-answerFrom").inputValue()) ===
        targetDay + "T22:45" &&
      (await page.locator("#create-disputeHours").inputValue()) === "2",
  );
  check(
    "Default bounty reserves two prices and five rewards",
    (await page.locator("#create-bounty").inputValue()) === "1.25",
  );
  await page
    .getByRole("combobox", { name: "Market token", exact: true })
    .selectOption("1");
  await page.getByLabel("Answer type").selectOption("uint256");
  await page.getByLabel("Bucket bounds · 18-decimal units").fill("1, 2.5");
  await page.getByRole("button", { name: "Review market" }).click();
  await page.getByRole("heading", { name: "Review your market" }).waitFor();
  const reviewedFrom = await page.locator("#create-fromBlock").inputValue();
  mockHead += 3n;
  await page.getByRole("button", {name:"Refresh",exact:true}).click();
  await page.getByText(`Synced · block ${mockHead.toLocaleString()}`, {exact:false}).waitFor();
  check("Chain refresh preserves reviewed evidence blocks", await page.locator("#create-fromBlock").inputValue() === reviewedFrom && await page.getByRole("heading", {name:"Review your market"}).isVisible());
  await scanAxe("creator review / mobile / dark");
  await shot("create-360");
  check(
    "Creator review has no 360px overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  allowance = 0n;
  await page
    .getByRole("button", { name: "Approve bounty & create market" })
    .click();
  await page
    .getByRole("heading", { name: "Markets", exact: true })
    .waitFor();
  const created = decodeFunctionData({ abi, data: sent.at(-1).data });
  check(
    "Create encodes new reward and collateral params",
    created.functionName === "createMarket" &&
      created.args[0].collateralId === 1 &&
      created.args[0].settlerReward === parseUnits(".05", 18) &&
      created.args[0].bounty === parseUnits("1.25", 18),
  );
  check(
    "WETH market bounty approval remains IMD",
    sent.at(-2).to.toLowerCase() === d.token &&
      decodeFunctionData({ abi: erc20Abi, data: sent.at(-2).data }).args[1] ===
        created.args[0].bounty,
  );
  const primary = JSON.parse(
    Buffer.from(created.args[1].slice(2), "hex").toString(),
  );
  check(
    "Create body pins mainnet oracle consumer",
    primary.consumer.chainId === 1 &&
      primary.consumer.verifyingContract === d.oracle,
  );
  allowed = false;
  await change("open", "create");
  await page
    .getByRole("heading", { name: "This wallet isn’t an approved creator" })
    .waitFor();
  check(
    "Allowlist gates creator controls",
    (await page.locator("#create-question").count()) === 0,
  );
  allowed = true;
  await change("portfolio", "portfolio");
  await page.getByRole("heading", { name: "Positions", exact: true }).waitFor();
  check(
    "Portfolio retains settled positions in both tokens",
    (await page.locator(".position").count()) === 2 &&
      (await page
        .getByRole("heading", { name: "IMD positions" })
        .isVisible()) &&
      (await page.getByRole("heading", { name: "WETH positions" }).isVisible()),
  );
  await page.getByLabel("Unwrap amount · WETH").fill("0.004");
  await page.getByRole("button", { name: "Unwrap", exact: true }).click();
  await confirmed();
  check(
    "Unwrap sends WETH9.withdraw amount",
    sent.at(-1).to.toLowerCase() === d.weth &&
      decodeFunctionData({ abi: wethAbi, data: sent.at(-1).data }).args[0] ===
        parseUnits(".004", 18),
  );
  const claimButton = page.getByRole("button", {
    name: "Claim refund",
    exact: true,
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent.includes("Claim refund") && !b.disabled,
    ),
  );
  await claimButton.click();
  await confirmed();
  check(
    "Refund position claims market collateral",
    decodeFunctionData({ abi, data: sent.at(-1).data }).args[0] === 2n,
  );
  await scanAxe("portfolio / mobile / dark");
  await shot("portfolio-360");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .first()
    .click();
  await scanAxe("portfolio / desktop / light");
  for (const [state, label, fn, id] of [
    ["closed", "Request answer", "resolve", 1n],
    ["answered", "Submit answer", "propose", 1n],
    ["provisional", "Escalate", "escalate", 1n],
    ["finalizable", "Finalize", "finalize", 1n],
    ["voidable", "Refund", "voidMarket", 2n],
  ]) {
    await change(state, "market/" + id);
    const button = page.getByRole("button", { name: new RegExp("^" + label) });
    await page.waitForFunction(
      (label) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.startsWith(label) && !b.disabled,
        ),
      label,
    );
    await button.click();
    await confirmed();
    const decoded = decodeFunctionData({ abi, data: sent.at(-1).data });
    check(
      label + " sends simulated permissionless call",
      decoded.functionName === fn && decoded.args[0] === id,
    );
  }
  await shot("settlement-desktop");
  await change("leaderboard", "leaderboard");
  await page
    .getByRole("link", { name: /verdict-fixture.eth/ })
    .first()
    .waitFor();
  check(
    "Leaderboard uses reverse and forward-verified ENS",
    await page
      .getByRole("link", { name: /verdict-fixture.eth/ })
      .first()
      .isVisible(),
  );
  check(
    "Trader rank includes three finalized markets",
    (await page.getByRole("table").first().innerText()).includes("3 finalized"),
  );
  check(
    "Share my rank includes the selected token",
    (
      await page
        .getByRole("link", { name: /Share my rank on X/ })
        .first()
        .getAttribute("href")
    ).includes("IMD"),
  );
  for (const tab of ["Agents", "Creators", "Settlers"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.getByRole("table").first().waitFor();
    await page.getByLabel("Period").selectOption("week");
    check(
      `Populated ${tab} rankings support last 7 days`,
      await page.getByRole("table").first().isVisible(),
    );
  }
  await page.getByRole("button", { name: "Traders", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 844 });
  check(
    "Leaderboard table stays within mobile page",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await scanAxe("populated leaderboard / mobile / light");
  await shot("leaderboard-360");
  check("No uncaught browser errors", errors.length === 0);
  const report = {
    checkedAt: new Date().toISOString(),
    scope:
      "Deterministic RPC and EIP-6963 mock wallet with mainnet ABI/runtime checks. All writes intercepted; no live transaction broadcast.",
    results,
    axeResults,
    errors,
    transactionCount: sent.length,
    requestCount: requests.length,
  };
  fs.writeFileSync(
    path.join(root, "web/validation/wallet-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  }
} catch (e) {
  fs.writeFileSync(
    path.join(root, "test/scratch/wallet-failure.json"),
    JSON.stringify(
      {
        message: e.message,
        results,
        axeResults,
        errors,
        requests: requests.slice(-15),
      },
      null,
      2,
    ),
  );
  await shot("wallet-failure");
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
