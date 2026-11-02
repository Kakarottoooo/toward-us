import { createSign } from "node:crypto";

// App push (iPhone and Android) through Firebase Cloud Messaging HTTP v1. Live only when FCM_SERVICE_ACCOUNT_JSON holds a
// Google service account; otherwise `configured` is false and nothing touches the network. The OAuth exchange is the
// standard service-account flow (RS256 JWT -> access token) done with node:crypto, so no Google SDK is needed.
// FCM_API_BASE redirects both the token exchange and the send to a local stub for probes; it is ignored in production.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_BASE = "https://fcm.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
// A token the provider no longer knows (or never accepted) is dead: the device record is deactivated instead of retried.
const EXPIRED = new Set(["UNREGISTERED", "INVALID_ARGUMENT"]);
let announced = false;

export function createNativePush({ serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON || "", apiBase = process.env.NODE_ENV === "production" ? "" : process.env.FCM_API_BASE || "", fetchImpl = (...args) => globalThis.fetch(...args), log = console } = {}) {
  const account = parseAccount(serviceAccountJson);
  // The override only ever points at a local stub: a signed assertion and device tokens must not go to any other host.
  if (apiBase && !loopback(apiBase)) { log.log("Native push: FCM_API_BASE ignored (only localhost, 127.0.0.1 or ::1 are allowed)"); apiBase = ""; }
  if (!announced) { announced = true; log.log(account ? `Native push: FCM ready (project ${account.project_id})` : serviceAccountJson ? "Native push: off (FCM_SERVICE_ACCOUNT_JSON is not a usable service account)" : "Native push: off (FCM_SERVICE_ACCOUNT_JSON is not set)"); }
  if (!account) return { configured: false, async send() { throw Object.assign(new Error("Native push is not configured."), { code: "push_not_configured" }); } };
  const base = apiBase.replace(/\/+$/, "");
  const tokenUrl = base ? `${base}/token` : GOOGLE_TOKEN_URL;
  const sendUrl = `${base || FCM_BASE}/v1/projects/${account.project_id}/messages:send`;
  let cached = null, pending = null;
  const accessToken = async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    pending ||= (async () => {
      const iat = Math.floor(Date.now() / 1000);
      const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: account.client_email, scope: SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 })}`;
      const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url")}`;
      const response = await fetchImpl(tokenUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
      const result = await response.json().catch(() => ({}));
      // Never surface the token endpoint's body: it can echo credential details. A credential problem is retried like an outage.
      if (!response.ok || typeof result.access_token !== "string") throw Object.assign(new Error("FCM credentials were not accepted."), { statusCode: 503, code: "native_auth_failed" });
      cached = { token: result.access_token, expiresAt: Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000 };
      return cached.token;
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    configured: true,
    // Callers pass only vague copy and an in-app path: no reminder title, name or private text reaches a lock screen.
    async send(token, { title, body, url = "/" }) {
      const response = await fetchImpl(sendUrl, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title, body }, data: { url }, android: { priority: "high" }, apns: { payload: { aps: { sound: "default" } } } } }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.name) return { statusCode: response.status };
      if (response.status === 401) cached = null;
      const failure = result?.error || {};
      const errorCode = (Array.isArray(failure.details) ? failure.details : []).find((item) => item?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")?.errorCode || failure.status;
      throw Object.assign(new Error("FCM did not accept the notification."), { statusCode: response.ok ? 502 : response.status, code: `fcm_${String(errorCode || response.status).toLowerCase()}`, expired: EXPIRED.has(errorCode) });
    },
  };
}

function parseAccount(raw) {
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    return account?.type === "service_account" && PROJECT.test(account.project_id || "") && /^[^\s@]+@[^\s@]+$/.test(account.client_email || "") && String(account.private_key || "").includes("PRIVATE KEY") ? account : null;
  } catch { return null; }
}
function loopback(value) { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; } }
function b64(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
