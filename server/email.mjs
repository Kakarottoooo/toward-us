// Transactional email. Production sends through Resend when RESEND_API_KEY is set; local development logs the message
// (including its link) so a reset flow can be tried without a mail account. Tests inject their own sender instead.
const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export function createEmailSender({ env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  const apiKey = env.RESEND_API_KEY || "";
  const configured = Boolean(apiKey);
  const production = env.NODE_ENV === "production";
  async function send({ to, subject, text, html, link }) {
    if (!configured) {
      if (!production) log.log(`[email to ${to}] ${subject} ${link || text}`);
      return { sent: false };
    }
    try {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM || "Pinky <onboarding@resend.dev>", to: [to], subject, text, ...(html ? { html } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) { log.error(`[email] delivery failed with status ${response.status}`); return { sent: false }; }
      return { sent: true };
    } catch (error) {
      log.error(`[email] delivery failed (${error?.name === "TimeoutError" ? "timeout" : "network error"})`);
      return { sent: false };
    }
  }
  return { configured, send };
}
