import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Let mcp-server tests import @streetlight/core directly from source
      // instead of requiring a pre-built dist/.
      "@streetlight/core": path.resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
});
