// Reproducible toolchain kept entirely outside the source tree.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = fileURLToPath(new URL("../", import.meta.url));
const root = path.dirname(web.replace(/\/$/, ""));
const manifest = fs.readFileSync(path.join(web, "package.json"));
const lock = fs.readFileSync(path.join(web, "package-lock.json"));
const hash = createHash("sha256")
  .update(manifest)
  .update(lock)
  .digest("hex")
  .slice(0, 16);
const directory = path.join(os.tmpdir(), "verdict-toolchain-" + hash);
const modules = path.join(directory, "node_modules");
const mode = process.argv[2] || "build";
const modes = [
  "install",
  "browser:install",
  "build",
  "typecheck",
  "test",
  "test:browser",
  "test:wallet",
  "verify:contracts",
  "build:social",
  "preview",
  "dev",
];
if (!modes.includes(mode)) throw Error("Choose one of: " + modes.join(", "));
fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(path.join(directory, "installed"))) {
  fs.writeFileSync(path.join(directory, "package.json"), manifest);
  fs.writeFileSync(path.join(directory, "package-lock.json"), lock);
  execFileSync(
    "npm",
    [
      "ci",
      "--prefix",
      directory,
      "--cache",
      path.join(directory, "cache"),
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit" },
  );
  fs.writeFileSync(path.join(directory, "installed"), hash);
}
const env = {
  ...process.env,
  VERDICT_NODE_MODULES: modules,
  VERDICT_CACHE_DIR: path.join(directory, "vite-cache"),
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(directory, "browsers"),
};
const run = (file, args) =>
  execFileSync(file, args, { cwd: root, env, stdio: "inherit" });
if (mode === "install") console.log("Installed toolchain at " + directory);
else if (mode === "browser:install")
  run(path.join(modules, ".bin/playwright"), ["install", "chromium"]);
else if (mode === "build" || mode === "preview" || mode === "dev")
  run(path.join(modules, ".bin/vite"), [
    ...(mode === "dev" ? [] : [mode]),
    "--config",
    path.join(web, "vite.config.ts"),
    ...(mode === "build" ? [] : ["--host", "127.0.0.1"]),
  ]);
else if (mode === "test")
  run(path.join(modules, ".bin/vitest"), [
    "run",
    "--config",
    path.join(web, "vite.config.ts"),
  ]);
else if (mode === "typecheck") {
  const config = {
    extends: path.join(web, "tsconfig.json"),
    compilerOptions: {
      baseUrl: web,
      typeRoots: [path.join(modules, "@types")],
      paths: {
        react: [path.join(modules, "@types/react")],
        "react/*": [path.join(modules, "@types/react/*")],
        "react-dom/*": [path.join(modules, "@types/react-dom/*")],
        viem: [path.join(modules, "viem")],
        vitest: [path.join(modules, "vitest")],
      },
    },
  };
  const file = path.join(directory, "tsconfig.json");
  fs.writeFileSync(file, JSON.stringify(config));
  run(path.join(modules, ".bin/tsc"), ["--noEmit", "-p", file]);
} else {
  const files = {
    "test:browser": "browser-check.mjs",
    "test:wallet": "wallet-check.mjs",
    "verify:contracts": "verify-contracts.mjs",
    "build:social": "browser-check.mjs",
  };
  run(process.execPath, [
    path.join(web, "scripts", files[mode]),
    ...(mode === "build:social" ? ["--social"] : []),
    ...process.argv.slice(3),
  ]);
}
