import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { normalizeEmail, validEmail } from "./auth.mjs";

const googleIssuer = "https://accounts.google.com";
const appleIssuer = "https://appleid.apple.com";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL(appleIssuer + "/auth/keys"));

// Only the Apple refresh credential used on deletion needs to survive sign-in.
function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), content].map((part) => part.toString("base64url")).join(".");
}
function unseal(value, key) {
  const [iv, tag, content] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]).toString("utf8");
}
export function createOAuthProviders({ env = process.env, fetchImpl = fetch, keys = { google: googleKeys, apple: appleKeys } } = {}) {
  const storageKey = Buffer.from(env.APPLE_SIGNIN_TOKEN_KEY || "", "base64");
  const clientId = { google: env.GOOGLE_CLIENT_ID, apple: env.APPLE_SIGNIN_CLIENT_ID };
  const configured = {
    google: Boolean(clientId.google && env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(clientId.apple && env.APPLE_SIGNIN_TEAM_ID && env.APPLE_SIGNIN_KEY_ID && env.APPLE_SIGNIN_PRIVATE_KEY && storageKey.length === 32),
  };
  async function clientSecret(provider) {
    if (provider === "google") return env.GOOGLE_CLIENT_SECRET;
    const key = await importPKCS8(env.APPLE_SIGNIN_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256");
    return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: env.APPLE_SIGNIN_KEY_ID })
      .setIssuer(env.APPLE_SIGNIN_TEAM_ID).setSubject(clientId.apple).setAudience(appleIssuer)
      .setIssuedAt().setExpirationTime("5m").sign(key);
  }
  async function post(provider, endpoint, params) {
    const response = await fetchImpl(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ ...params, client_id: clientId[provider], client_secret: await clientSecret(provider) }),
    });
    if (!response.ok) throw new Error("Provider unavailable");
    return response;
  }
  return {
    configured,
    authorization(provider, { state, nonce, redirectUri, challenge }) {
      const google = provider === "google";
      const url = new URL(google ? googleIssuer + "/o/oauth2/v2/auth" : appleIssuer + "/auth/authorize");
      url.search = new URLSearchParams({ client_id: clientId[provider], redirect_uri: redirectUri,
        response_type: "code", state, nonce, scope: google ? "openid email profile" : "name email",
        ...(google ? { code_challenge_method: "S256", code_challenge: challenge } : { response_mode: "form_post" }),
      }).toString();
      return url.toString();
    },
    async redeem(provider, code, { nonce, verifier, redirectUri }) {
      const google = provider === "google";
      const response = await post(provider, google ? "https://oauth2.googleapis.com/token" : appleIssuer + "/auth/token", {
        grant_type: "authorization_code", redirect_uri: redirectUri, code, ...(google ? { code_verifier: verifier } : {}),
      });
      const tokens = await response.json();
      const { payload } = await jwtVerify(tokens.id_token, keys[provider], {
        algorithms: ["RS256"], issuer: google ? [googleIssuer, "accounts.google.com"] : appleIssuer, audience: clientId[provider],
        requiredClaims: ["sub", "exp", "iat", "nonce"], maxTokenAge: "10m", clockTolerance: 5,
      });
      if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
          (payload.azp && payload.azp !== clientId[provider]) || (Array.isArray(payload.aud) && payload.aud.length > 1 && !payload.azp)) throw new Error("Invalid identity");
      const email = typeof payload.email === "string" && payload.email.length <= 254 &&
        (payload.email_verified === true || (!google && payload.email_verified === "true")) ? normalizeEmail(payload.email) : null;
      return {
        provider, subject: payload.sub, email: email && validEmail(email) ? email : null,
        emailOmitted: payload.email === undefined,
        name: typeof payload.name === "string" ? payload.name.trim().replace(/[<>]/g, "").slice(0, 24) : "",
        relay: !google && (payload.is_private_email === true || payload.is_private_email === "true" || email?.endsWith("@privaterelay.appleid.com")),
        authoritative: !google || /@(gmail|googlemail)\.com$/.test(email || "") || (typeof payload.hd === "string" && Boolean(payload.hd.trim())),
        revocation: !google && tokens.refresh_token ? seal(tokens.refresh_token, storageKey) : null,
      };
    },
    async revokeApple(encrypted) {
      await post("apple", appleIssuer + "/auth/revoke", { token: unseal(encrypted, storageKey), token_type_hint: "refresh_token" });
    },
  };
}
