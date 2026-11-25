import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.contract.test.{ts,tsx}", "node_modules", ".next"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
  },
});
