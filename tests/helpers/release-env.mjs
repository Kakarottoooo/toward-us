// Render also exposes service credentials during builds. App tests use temporary stores and
// supply their own synthetic provider credentials when exercising those integrations.
for (const name of [
  "DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "REPLICATE_API_TOKEN",
  "OAUTH_PUBLIC_ORIGINS", "OAUTH_PUBLIC_ORIGIN", "TOWARD_US_BASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "APPLE_SIGNIN_CLIENT_ID", "APPLE_SIGNIN_TEAM_ID", "APPLE_SIGNIN_KEY_ID",
  "APPLE_SIGNIN_PRIVATE_KEY", "APPLE_SIGNIN_TOKEN_KEY", "RESEND_API_KEY", "EMAIL_FROM",
  "SENDBLUE_API_KEY", "SENDBLUE_API_SECRET", "SENDBLUE_WEBHOOK_SECRET",
  "FCM_SERVICE_ACCOUNT_JSON", "VAPID_PRIVATE_KEY", "REMINDER_RUN_SECRET",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PINKY_METRICS_ADMIN_TOKEN",
  "APNS_PRIVATE_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "SEEDANCE_KEY_FILE", "SENDBLUE_FROM_NUMBER",
]) delete process.env[name];
// Anything a test starts from here (server/index.mjs included) stays off the owner's home secrets file.
process.env.TOWARD_US_TEST = "1";
