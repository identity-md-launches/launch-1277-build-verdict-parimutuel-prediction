import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const dependencies = process.env.VERDICT_NODE_MODULES;
export default {
  root,
  base: "./",
  publicDir: "public",
  cacheDir: process.env.VERDICT_CACHE_DIR || "/tmp/verdict-vite-cache",
  resolve: {
    alias: dependencies
      ? {
          "react-dom": path.join(dependencies, "react-dom"),
          react: path.join(dependencies, "react"),
          viem: path.join(dependencies, "viem"),
        }
      : {},
  },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("/node_modules/")
            ? id.includes("/react") || id.includes("/scheduler/")
              ? "react"
              : "chain"
            : undefined,
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", cache: false },
};
