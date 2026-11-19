// Render also exposes service credentials during builds. App tests use temporary stores and
// supply their own synthetic provider credentials when exercising those integrations.
for (const name of [
  "DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "REPLICATE_API_TOKEN",
  "RESEND_API_KEY", "SENDBLUE_API_KEY", "SENDBLUE_API_SECRET", "SENDBLUE_WEBHOOK_SECRET",
  "FCM_SERVICE_ACCOUNT_JSON", "VAPID_PRIVATE_KEY", "REMINDER_RUN_SECRET",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PINKY_METRICS_ADMIN_TOKEN",
]) delete process.env[name];
