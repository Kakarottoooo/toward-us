import { createHash } from "node:crypto";

// No arbitrary hosts, ports, credentials or redirects: subscriptions are an SSRF boundary.
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

export function validatePushSubscription(input) {
  let url;
  try { url = new URL(input?.endpoint); } catch { throw invalidSubscription(); }
  if (url.protocol !== "https:" || !PUSH_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash || url.pathname === "/" || input.endpoint.length > 2048) throw invalidSubscription();
  const { p256dh, auth } = input?.keys || {};
  if (!validKey(p256dh, 65) || Buffer.from(p256dh, "base64url")[0] !== 4 || !validKey(auth, 16)) throw invalidSubscription();
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function createPushDelivery({ publicKey = process.env.VAPID_PUBLIC_KEY || "", privateKey = process.env.VAPID_PRIVATE_KEY || "", subject = process.env.VAPID_SUBJECT || "" } = {}) {
  const enabled = Boolean(publicKey && privateKey && /^https:\/\/[^\s]+$|^mailto:[^\s]+@[^\s]+$/.test(subject));
  return {
    enabled, publicKey: enabled ? publicKey : "",
    async sendPush(subscription, payload, { dedupeKey } = {}) {
      if (!enabled) throw Object.assign(new Error("Push is not configured."), { code: "push_not_configured" });
      const validated = validatePushSubscription(subscription);
      const { default: webpush } = await import("web-push");
      const result = await webpush.sendNotification(validated, JSON.stringify(payload), {
        vapidDetails: { publicKey, privateKey, subject }, TTL: 3600, timeout: 10_000,
        urgency: "normal", topic: createHash("sha256").update(dedupeKey || payload.tag).digest("base64url").slice(0, 32),
      });
      if (!Number.isInteger(result.statusCode) || result.statusCode < 200 || result.statusCode >= 300) throw Object.assign(new Error("Push service rejected request."), { statusCode: result.statusCode });
      // Provider acceptance is not evidence that a device displayed or a person read it.
      return { statusCode: result.statusCode };
    },
  };
}

function validKey(value, size) { return typeof value === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === size; }
function invalidSubscription() { return Object.assign(new Error("Invalid or unsupported push subscription."), { statusCode: 400, code: "invalid_subscription" }); }
