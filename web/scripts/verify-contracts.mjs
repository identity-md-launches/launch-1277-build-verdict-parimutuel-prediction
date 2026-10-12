// Read-only mainnet ABI/deployment check. No keys, signing, or on-chain writes.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_CHAIN, LINKS } from "../src/config.ts";
const require = createRequire(
  process.env.VERDICT_NODE_MODULES
    ? path.join(process.env.VERDICT_NODE_MODULES, "../package.json")
    : import.meta.url,
);
const {
  createPublicClient,
  fallback,
  http,
  keccak256,
  toHex,
  erc20Abi,
} = require("viem");
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const d = DEFAULT_CHAIN.deployment;
const provenance = JSON.parse(fs.readFileSync("web/src/abi/provenance.json"));
const client = createPublicClient({
  transport: fallback(
    (process.env.VERDICT_RPC_URL
      ? [process.env.VERDICT_RPC_URL]
      : DEFAULT_CHAIN.rpcUrls
    ).map((url) => http(url, { timeout: 15000, retryCount: 1 })),
    { rank: false },
  ),
});
if ((await client.getChainId()) !== 1)
  throw Error("RPC is not Ethereum mainnet");
const head = await client.getBlock();
const contracts = [];
for (const [name, configKey] of [
  ["VerdictMarkets", "markets"],
  ["VerdictOracle", "oracle"],
  ["VerdictBurnVault", "burnVault"],
]) {
  const local = JSON.parse(fs.readFileSync(`web/src/abi/${name}.json`));
  const upstream = JSON.parse(
    execFileSync(
      "curl",
      [
        "-fLsS",
        "--max-time",
        "30",
        `https://raw.githubusercontent.com/identity-md-launches/launch-1346-deploy-repository-s-audited-verdict/${LINKS.sourceCommit}/docs/agents/abi/${name}.json`,
      ],
      { encoding: "utf8" },
    ),
  );
  const hash = keccak256(toHex(JSON.stringify(canonical(local))));
  if (JSON.stringify(canonical(local)) !== JSON.stringify(canonical(upstream)))
    throw Error(`${name} differs from pinned ABI`);
  if (hash !== provenance.contracts[name].abiHash)
    throw Error(`${name} ABI hash differs from provenance`);
  const code = await client.getBytecode({
    address: d[configKey],
    blockNumber: head.number,
  });
  if (!code || keccak256(code) !== d.codeHashes[configKey])
    throw Error(`${name} runtime hash mismatch`);
  contracts.push({
    name,
    address: d[configKey],
    abiHash: hash,
    observedRuntimeHash: keccak256(code),
    runtimeBytes: (code.length - 2) / 2,
  });
}
const abi = JSON.parse(fs.readFileSync("web/src/abi/VerdictMarkets.json"));
const oracle = JSON.parse(fs.readFileSync("web/src/abi/VerdictOracle.json"));
const read = (functionName, args = []) =>
  client.readContract({
    address: d.markets,
    abi,
    functionName,
    args,
    blockNumber: head.number,
  });
const collateral = await Promise.all(
  [0, 1].map((slot) => read("collateralConfig", [slot])),
);
for (const [slot, token, creator, burn, treasury, cap] of [
  [0, d.token, 150, 50, 50, 500n * 10n ** 18n],
  [1, d.weth, 150, 0, 100, 10n ** 18n],
]) {
  const c = collateral[slot];
  if (
    c.token.toLowerCase() !== token ||
    c.creatorFeeBps !== creator ||
    c.burnFeeBps !== burn ||
    c.treasuryFeeBps !== treasury ||
    c.maxPoolPerMarket !== cap
  )
    throw Error("Unexpected collateral slot " + slot);
  if (
    (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "decimals",
    })) !== 18
  )
    throw Error("Unexpected token decimals");
}
for (const [fn, expected] of [
  ["asset", d.token],
  ["intake", d.intake],
]) {
  const result = await client.readContract({
    address: d.oracle,
    abi: oracle,
    functionName: fn,
  });
  if (result.toLowerCase() !== expected) throw Error("Unexpected oracle " + fn);
}
const configDelay = await client.readContract({
  address: d.oracle,
  abi: oracle,
  functionName: "configDelay",
});
if (configDelay !== 172800n) throw Error("Oracle config delay is not 48 hours");
const count = await read("marketCount"),
  maxSettlerReward = await read("maxSettlerReward");
const report = {
  checkedAt: new Date().toISOString(),
  chainId: 1,
  block: head.number,
  sourceCommit: LINKS.sourceCommit,
  contracts,
  collateral,
  marketCount: count,
  maxSettlerReward,
  configDelaySeconds: configDelay,
  note: "ABIs compared byte-structurally to pinned source exports. Runtime hashes observed from mainnet RPC and checked against config; this does not independently recompile or audit deployed Solidity.",
};
fs.writeFileSync(
  "web/validation/contract-verification.json",
  JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) +
    "\n",
);
console.log(
  JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2),
);
