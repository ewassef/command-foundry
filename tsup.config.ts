import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "main/index": "src/main/index.ts",
      "preload/index": "src/preload/index.ts"
    },
    format: ["cjs"],
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    target: "node22",
    outExtension: () => ({
      js: ".cjs"
    }),
    external: ["electron"]
  }
]);
