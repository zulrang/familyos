import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // Fast lane: former check:* scripts + future unit/component tests.
    // Contract lane: `pnpm test:contract` (vitest.contract.config.mts).
    // Component tests: add // @vitest-environment jsdom at file top.
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.contract.test.{ts,tsx}", "node_modules", ".next"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
  },
});
