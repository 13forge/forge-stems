import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** Vendored wasm-pack package. Module imports use the `@wasm` alias. */
const wasmPkg = fileURLToPath(new URL("./vendor/forge-audio-wasm-v3", import.meta.url));

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@wasm": wasmPkg,
    },
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL(".", import.meta.url))],
    },
  },
  optimizeDeps: {
    exclude: ["@wasm"],
  },
});
