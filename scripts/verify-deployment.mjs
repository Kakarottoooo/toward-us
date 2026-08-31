const baseUrl = String(process.env.TOWARD_US_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("Set TOWARD_US_BASE_URL to the deployed HTTPS origin.");
if (!baseUrl.startsWith("https://")) throw new Error("TOWARD_US_BASE_URL must use HTTPS.");

const health = await fetch(`${baseUrl}/api/health`, { redirect: "manual" });
assert(health.status === 200, `health returned ${health.status}`);
const healthBody = await health.json();
assert(healthBody.ok === true, "health body is not ready");
assert(healthBody.storage === "postgres", `expected postgres, received ${healthBody.storage}`);
assert(Boolean(health.headers.get("strict-transport-security")), "HSTS header is missing");

const anonymous = await fetch(`${baseUrl}/api/auth/me`);
assert(anonymous.status === 200, `anonymous auth probe returned ${anonymous.status}`);
const anonymousBody = await anonymous.json();
assert(anonymousBody.user === null, "anonymous request unexpectedly received an identity");

const isolated = await fetch(`${baseUrl}/api/rooms/ABC234`);
assert(isolated.status === 401, `protected room route did not fail closed (${isolated.status})`);

console.log(JSON.stringify({ ok: true, origin: baseUrl, storage: healthBody.storage, aiReady: healthBody.aiReady, https: true, anonymousBoundary: "closed" }, null, 2));

function assert(condition, message) { if (!condition) throw new Error(message); }
