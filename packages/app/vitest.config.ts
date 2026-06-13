import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/db.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // The singleton db pool is pinned to a single connection in test mode,
    // so test files MUST run serially — otherwise two files would race
    // for the same backend session and corrupt each other's transactions.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
