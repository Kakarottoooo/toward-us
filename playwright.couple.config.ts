import { defineConfig } from "@playwright/test";

// Two-person runs (tests/couple-onboarding.spec.ts, tests/conversation-pages.spec.ts) against a throwaway local server: its own data file under
// work/, no secrets file, no AI keys (Pinky answers with its fixed local copy) and the stand-in character maker, so the
// whole path runs offline and never reaches a paid model, email, SMS or push service.
const port = 5196;
const run = `work/couple-onboarding/${Date.now()}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/couple-onboarding.spec.ts", "**/conversation-pages.spec.ts"],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: "node server/index.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      TOWARD_US_DATA_FILE: `${run}/store.json`,
      TOWARD_US_ENV_FILE: `${run}/no-secrets.env`,
      DATABASE_URL: "",
      AI_PROVIDER: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      CHARACTER_MAKER: "fake",
      RESEND_API_KEY: "",
      SENDBLUE_API_KEY: "",
      VAPID_PRIVATE_KEY: "",
      FCM_SERVICE_ACCOUNT_JSON: "",
    },
  },
});
