import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    globals: false,
    // GitHub's shared runners are up to ten times slower than a laptop on the jsdom popup tests (a
    // megabyte page title took 6.3 s there, 0.6 s here). A hang still fails; tests that measure speed
    // keep their own, stricter limits.
    testTimeout: 15000
  }
});
