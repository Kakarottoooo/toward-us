const baseUrl = String(process.env.TOWARD_US_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("Set TOWARD_US_BASE_URL to the deployed HTTPS origin.");
if (!baseUrl.startsWith("https://")) throw new Error("TOWARD_US_BASE_URL must use HTTPS.");

const health = await fetch(`${baseUrl}/api/health`, { redirect: "manual" });
assert(health.status === 200, `health returned ${health.status}`);
const healthBody = await health.json();
if (process.env.EXPECTED_COMMIT) assert(healthBody.commit === process.env.EXPECTED_COMMIT, "deployed commit does not match the reviewed build");
assert(healthBody.ok === true, "health body is not ready");
assert(healthBody.storage === "postgres", `expected postgres, received ${healthBody.storage}`);
assert(Boolean(health.headers.get("strict-transport-security")), "HSTS header is missing");

const anonymous = await fetch(`${baseUrl}/api/auth/me`);
assert(anonymous.status === 200, `anonymous auth probe returned ${anonymous.status}`);
const anonymousBody = await anonymous.json();
assert(anonymousBody.user === null, "anonymous request unexpectedly received an identity");

const isolated = await fetch(`${baseUrl}/api/rooms/ABC234`);
assert(isolated.status === 401, `protected room route did not fail closed (${isolated.status})`);

for (const route of ["/api/private-agent/threads", "/api/memories", "/api/checkins", "/api/privacy", "/api/reminders"]) { const response = await fetch(`${baseUrl}${route}`); assert(response.status === 401, `${route} did not fail closed (${response.status})`); }
for (const route of ["/", "/demo", "/toward-us-sw.js"]) { const response = await fetch(`${baseUrl}${route}`); assert(response.status === 200, `${route} is unavailable (${response.status})`); }

console.log(JSON.stringify({ ok: true, commit: healthBody.commit, origin: baseUrl, storage: healthBody.storage, aiReady: healthBody.aiReady, https: true, anonymousBoundary: "closed" }, null, 2));

function assert(condition, message) { if (!condition) throw new Error(message); }
