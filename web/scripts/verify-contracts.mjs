import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DEFAULT_CHAIN } from "../src/config.ts";
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
} = require("viem");
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = fs.mkdtempSync("/tmp/verdict-contract-check-");
const provenance = JSON.parse(
  fs.readFileSync(path.join(root, "web/src/abi/provenance.json")),
);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const client = createPublicClient({
  transport: fallback(
    DEFAULT_CHAIN.rpcUrls.map((url) => http(url, { timeout: 12000 })),
    { rank: false },
  ),
});
const results = [];
try {
  execFileSync(
    "forge",
    [
      "build",
      "--out",
      path.join(directory, "out"),
      "--cache-path",
      path.join(directory, "cache"),
      "--skip",
      "test",
      "--skip",
      "script",
    ],
    { cwd: root, stdio: "pipe" },
  );
  if ((await client.getChainId()) !== DEFAULT_CHAIN.chainId)
    throw Error("Chain ID mismatch");
  for (const [name, metadata] of Object.entries(provenance.contracts)) {
    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(directory, "out", name + ".sol", name + ".json"),
      ),
    );
    const checkedIn = JSON.parse(
      fs.readFileSync(path.join(root, "web/src/abi", name + ".json")),
    );
    const hash = keccak256(
      toHex(JSON.stringify(canonical(artifact.abi))),
    ).slice(2);
    if (
      hash !== metadata.abiHash ||
      JSON.stringify(canonical(artifact.abi)) !==
        JSON.stringify(canonical(checkedIn))
    )
      throw Error(name + " ABI mismatch");
    const code = await client.getBytecode({
      address: DEFAULT_CHAIN.deployment[metadata.configKey],
    });
    if (
      !code ||
      keccak256(code) !==
        DEFAULT_CHAIN.deployment.codeHashes[metadata.configKey]
    )
      throw Error(name + " runtime hash mismatch");
    const stripImmutables = (value) => {
      const chars = value.slice(2).split("");
      for (const refs of Object.values(
        artifact.deployedBytecode.immutableReferences || {},
      ))
        for (const ref of refs)
          chars.fill("0", ref.start * 2, (ref.start + ref.length) * 2);
      return chars.join("");
    };
    if (
      stripImmutables(code) !==
      stripImmutables(artifact.deployedBytecode.object)
    )
      throw Error(name + " compiled runtime mismatch");
    results.push({
      contract: name,
      abiHash: hash,
      runtimeCodeHash: keccak256(code),
      compiledRuntimeMatches: true,
    });
  }
  const report = {
    checkedAt: new Date().toISOString(),
    chainId: DEFAULT_CHAIN.chainId,
    sourceCommit: provenance.sourceCommit,
    results,
  };
  fs.writeFileSync(
    path.join(root, "artifacts/contract-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
