import { defineConfig } from "@playwright/test";

const port = 5181;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/relationship-agent.spec.ts", "**/decision-lifecycle.spec.ts", "**/personal-lifecycle.spec.ts"],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server/index.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      OPENAI_API_KEY: "",
      DATABASE_URL: "",
      PORT: String(port),
      TOWARD_US_DATA_FILE: "data/relationship-agent.e2e.json",
    },
  },
});
