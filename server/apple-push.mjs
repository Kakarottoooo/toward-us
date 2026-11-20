import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";

const hosts = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

// An APNs .p8 signing key for this team/topic, kept in the service's secret store.
export function createApplePush() {
  const kid = process.env.APNS_KEY_ID, team = process.env.APNS_TEAM_ID;
  let key;
  try {
    const candidate = createPrivateKey((process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n"));
    if (candidate.asymmetricKeyDetails?.namedCurve === "prime256v1") key = candidate;
  } catch { /* missing or invalid provider credentials */ }
  const configured = Boolean(key && /^[A-Z0-9]{10}$/.test(kid || "") && team === "693NJRHRV5");
  let bearer, issued = 0;
  function authorization() {
    const now = Math.floor(Date.now() / 1000);
    if (!bearer || now - issued >= 50 * 60) {
      const claims = encode({ alg: "ES256", kid }) + "." + encode({ iss: team, iat: now });
      bearer = claims + "." + sign("sha256", Buffer.from(claims), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
      issued = now;
    }
    return bearer;
  }

  async function deliver(host, token, payload) {
    const session = connect(host);
    try {
      return await new Promise((resolve, reject) => {
        const timeout = () => session.destroy(Object.assign(new Error("APNs timed out."), { code: "apns_timeout" }));
        session.setTimeout(10_000, timeout);
        session.once("error", reject);
        const req = session.request({
          ":method": "POST", ":path": "/3/device/" + token, authorization: "bearer " + authorization(),
          "apns-topic": "us.toward.app", "apns-push-type": "alert", "apns-priority": "10",
        });
        req.setEncoding("utf8");
        let status, body = "";
        req.on("response", (headers) => { status = Number(headers[":status"]); });
        req.on("data", (chunk) => { body += chunk; });
        req.once("error", reject);
        req.once("end", () => {
          if (status === 200) return resolve({ statusCode: status });
          let reason;
          try { reason = JSON.parse(body).reason; } catch { /* proxy or service error */ }
          reject(Object.assign(new Error("APNs did not accept the notification."), {
            statusCode: status || 503, code: "apns_rejected", reason, expired: status === 410,
          }));
        });
        req.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: payload.url }));
      });
    } finally { session.close(); }
  }
  return {
    configured,
    async send(token, payload) {
      if (!configured) throw Object.assign(new Error("APNs is unavailable."), { code: "push_not_configured", statusCode: 503 });
      // Development and distribution builds receive tokens from different APNs environments.
      // Check the sandbox only if production explicitly declines the token without sending anything.
      try { return await deliver(hosts.production, token, payload); }
      catch (error) {
        if (error.reason !== "BadDeviceToken") throw error;
        try { return await deliver(hosts.development, token, payload); }
        catch (other) { if (other.reason === "BadDeviceToken") other.expired = true; throw other; }
      }
    },
  };
}
