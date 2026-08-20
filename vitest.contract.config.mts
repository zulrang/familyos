import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Shared Fake ↔ real-adapter contract suite (recorded or live Google).
    // Keep out of the fast lane so external deps don't gate every run.
    include: ["src/**/*.contract.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
    passWithNoTests: true,
  },
});
