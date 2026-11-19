import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { renderLegalPage } from "../server/legal.mjs";

// App Store review guidelines the server carries (founder 11-12 App Store prep): explicit consent before anything goes to a
// third-party AI (5.1.2(i)), a way to report the partner's content or Pinky's replies (1.2), and public privacy, terms and
// support pages (5.1.1(i), 1.5).
const password = "synthetic-test-password-26";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "pinky-appstore-"));
  const store = await createFileStore(join(directory, "state.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie, status = 200, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    assert.equal(response.status, status, `${path}: ${text.slice(0, 300)}`);
    const result = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : { html: text };
    return { ...result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = (name, extra = {}) => request("/api/auth/register", { method: "POST", body: { name, email: `${name}@example.test`, password, ...extra }, status: 201 });
  try { await run({ store, request, register }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test("third-party AI consent is given on sign-up or later, can be withdrawn, and every change is in the history", () => fixture(async ({ request, register }) => {
  const agreed = await register("agreed", { aiConsent: true });
  assert.match(agreed.user.aiConsentAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match((await request("/api/auth/me", { cookie: agreed.cookie })).user.aiConsentAt, /^\d{4}-/);

  // An account without consent (made before sign-up asked, or via the API) has none until it agrees.
  const later = await register("later");
  assert.equal(later.user.aiConsentAt, null);
  assert.equal((await request("/api/privacy", { cookie: later.cookie })).aiConsentAt, null);
  await request("/api/privacy/ai-consent", { method: "POST", cookie: later.cookie, body: { agree: "yes" }, status: 400 });
  const given = await request("/api/privacy/ai-consent", { method: "POST", cookie: later.cookie, body: { agree: true } });
  assert.match(given.aiConsentAt, /^\d{4}-/);
  assert.deepEqual(given.aiProviders, ["OpenAI", "Anthropic"]);
  assert.equal((await request("/api/auth/me", { cookie: later.cookie })).user.aiConsentAt, given.aiConsentAt);

  const withdrawn = await request("/api/privacy/ai-consent", { method: "POST", cookie: later.cookie, body: { agree: false } });
  assert.equal(withdrawn.aiConsentAt, null);
  const privacy = await request("/api/privacy", { cookie: later.cookie });
  assert.equal(privacy.aiConsentAt, null);
  assert.deepEqual(privacy.consentHistory.map((event) => event.eventType).filter((type) => type.startsWith("privacy.ai_consent")), ["privacy.ai_consent_withdrawn", "privacy.ai_consent_given"]);
  // Only the person themself: someone else's consent is never theirs to read or change.
  assert.match((await request("/api/auth/me", { cookie: agreed.cookie })).user.aiConsentAt, /^\d{4}-/);
  await request("/api/privacy/ai-consent", { method: "POST", body: { agree: true }, status: 401 });
}));

test("a report about the partner or Pinky goes to the team's queue marked urgent, skipping the model's sorting", () => fixture(async ({ store, request, register }) => {
  const member = await register("reporter", { aiConsent: true });
  await request("/api/feedback", { method: "POST", cookie: member.cookie, body: { report: "partner" }, status: 400 });
  const sent = await request("/api/feedback", { method: "POST", cookie: member.cookie, body: { report: "partner", text: "They keep sending threats.", context: { view: "settings-report" } }, status: 201 });
  assert.equal(sent.feedback.kind, "report");
  assert.equal(sent.feedback.severity, "high");
  const saved = (await store.listRecordsForJob("feedback")).find((record) => record.id === sent.feedback.id);
  assert.equal(saved.context.report, "partner");
  assert.equal(saved.visibility, "private");
  // Ordinary feedback is unchanged: no kind until sorted.
  const plain = await request("/api/feedback", { method: "POST", cookie: member.cookie, body: { text: "The button is small." }, status: 201 });
  assert.equal(plain.feedback.kind, null);
  // An unknown "report" value is just feedback.
  const odd = await request("/api/feedback", { method: "POST", cookie: member.cookie, body: { report: "everyone", text: "hm" }, status: 201 });
  assert.equal(odd.feedback.kind, null);
}));

test("privacy policy, terms and support are public pages in all three languages, naming the AI providers", () => fixture(async ({ request }) => {
  for (const page of ["privacy", "terms", "support"]) {
    for (const [lang, words] of [["zh", "返回 Pinky"], ["en", "Back to Pinky"], ["es", "Volver a Pinky"]]) {
      const { html } = await request(`/${page}?lang=${lang}`);
      assert.ok(html.includes(words), `${page} ${lang}`);
      assert.ok(html.includes(`data-testid="legal-${page}"`));
    }
  }
  assert.ok((await request("/privacy", { headers: { "accept-language": "es-MX,es;q=0.9" } })).html.includes("Política de privacidad de Pinky"));
  const policy = (await request("/privacy?lang=en")).html;
  for (const words of ["OpenAI", "Anthropic", "Delete account", "18 and older", "never uploaded", "We do not sell your data"]) assert.ok(policy.includes(words), words);
  assert.ok((await request("/terms?lang=zh")).html.includes("24 小时内"));
}));

test("the contact line uses the configured support address, and nothing else is a placeholder", () => {
  const withEmail = renderLegalPage("support", "en", { PINKY_SUPPORT_EMAIL: "help@pinky.example", PINKY_OPERATOR: "Example Labs LLC" });
  assert.ok(withEmail.includes('href="mailto:help@pinky.example"'));
  assert.ok(renderLegalPage("privacy", "en", { PINKY_OPERATOR: "Example Labs LLC" }).includes("Pinky is operated by Example Labs LLC."));
  const without = renderLegalPage("support", "zh", {});
  assert.ok(without.includes("设置 → 举报或求助"));
  assert.doesNotMatch(without + renderLegalPage("privacy", "es", {}), /TODO|TBD|lorem ipsum|\{\{|example\.com/);
  assert.ok(renderLegalPage("privacy", "zh", {}).includes("Pinky 由 Pinky 团队 运营"));
  assert.ok(renderLegalPage("privacy", "en", { PINKY_OPERATOR: "<script>" }).includes("&lt;script&gt;"));
});
