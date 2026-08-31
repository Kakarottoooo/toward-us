import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/beta-flow.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1400, height: 1200 },
    trace: "retain-on-failure",
  },
});
