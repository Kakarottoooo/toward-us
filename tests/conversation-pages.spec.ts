import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

// Pages a couple reaches from the conversation: earlier messages in Us, the 约定 page's "change requested" group, and the
// words shown when Pinky is unavailable. Two synthetic accounts on the offline test server (playwright.couple.config.ts):
// A uses the Chinese interface, B the English one; both on a phone.
const PASSWORD = "synthetic-couple-2026";
const PHONE = { width: 393, height: 852 };
const CJK = /[㐀-鿿]/;

test("earlier messages, a requested change and Pinky's own unavailable text", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await contextFor(browser, baseURL!, "zh"), b = await contextFor(browser, baseURL!, "en");
  await register(a.request, { name: "小彼", email: `pages-a-${suffix}@example.invalid`, language: "zh" });
  await register(b.request, { name: "Blue", email: `pages-b-${suffix}@example.invalid`, language: "en" });
  const invite = await postJson(a.request, "/api/partner/invitations", {});
  await postJson(b.request, "/api/partner/accept", { code: invite.pairing.invitation.code });

  // 1. More than the 200 messages the conversation keeps at hand: the oldest move to the archive, "更早的消息" brings them back.
  for (let index = 0; index < 205; index += 1) await postJson(a.request, "/api/together/messages", { text: `HISTORY_${String(index).padStart(3, "0")}`, itemId: `history-${index}`, language: "zh" });
  const pageA = await openUs(a, "我们俩");
  const earlier = pageA.getByTestId("earlier-messages");
  await expect(pageA.getByText("HISTORY_204")).toBeVisible();
  await expect(pageA.getByText("HISTORY_000", { exact: true })).toHaveCount(0);
  await expect(earlier).toHaveText("更早的消息");
  await earlier.click();
  await expect(pageA.getByText("HISTORY_001", { exact: true })).toBeVisible();
  await expect(pageA.getByText("HISTORY_000", { exact: true })).toHaveCount(0);
  await earlier.click();
  await expect(pageA.getByText("HISTORY_000", { exact: true })).toBeVisible();
  await expect(earlier).toHaveCount(0);
  await pageA.screenshot({ path: testInfo.outputPath("a-earlier-zh.png") });

  // 2. The server's 503 text (already in the language the member writes in) is what the App shows; only without one does
  // the App fall back to its own copy in the interface language.
  const pageB = await openUs(b, "Us");
  const unavailable = "Pinky 暂时不可用，什么都没有改动。请稍后再试。";
  await pageB.route("**/api/together/messages", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: unavailable }) }));
  await send(pageB, "Write to both…", "Pinky 这周的约定我做到了");
  await expect(pageB.getByRole("alert")).toHaveText(unavailable);
  await pageB.unroute("**/api/together/messages");
  await pageB.route("**/api/together/messages", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await send(pageB, "Write to both…", "Pinky are you there?");
  await expect(pageB.getByRole("alert")).toHaveText("The assistant is unavailable right now. Nothing was changed; try again soon.");
  await pageB.unroute("**/api/together/messages");

  // 3. B asks to change an agreement A proposed: both see it under "有人要求修改" / "Change requested", with who and why.
  const { agreement } = await postJson(a.request, "/api/together/agreements/draft", { title: "倒垃圾", summary: "谁倒垃圾", terms: ["每周一倒垃圾"], language: "zh" });
  await postJson(b.request, `/api/together/agreements/${agreement.id}/request-change`, { version: agreement.version, reason: "Tuesdays work better", language: "en" });
  await openAgreements(pageA);
  const changingA = pageA.locator("section", { has: pageA.getByRole("heading", { name: "有人要求修改" }) });
  await expect(changingA.getByText("倒垃圾", { exact: true })).toBeVisible();
  await expect(changingA.getByTestId("agreement-change")).toHaveText("Blue 想改：Tuesdays work better");
  await pageA.screenshot({ path: testInfo.outputPath("a-change-requested-zh.png") });
  await openAgreements(pageB);
  const changingB = pageB.locator("section", { has: pageB.getByRole("heading", { name: "Change requested" }) });
  await expect(changingB.getByTestId("agreement-change")).toHaveText("Blue wants a change: Tuesdays work better");
  await expect(pageB.getByRole("heading", { name: "Waiting for approval" })).toHaveCount(0);
  for (const heading of await pageB.locator(".agreements-page h2").allInnerTexts()) expect(heading).not.toMatch(CJK);
  await pageB.screenshot({ path: testInfo.outputPath("b-change-requested-en.png") });

  await a.close(); await b.close();
});

async function contextFor(browser: import("@playwright/test").Browser, baseURL: string, language: "zh" | "en") {
  const context = await browser.newContext({ baseURL, viewport: PHONE });
  // The welcome tour is covered by couple-onboarding.spec.ts; here it would only sit in front of the pages under test.
  await context.addInitScript((value) => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", value); }, language);
  return context;
}
async function openUs(context: BrowserContext, tab: string) {
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("conversation-screen")).toBeVisible();
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
  await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-selected", "true");
  return page;
}
async function openAgreements(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-drawer").click();
  await page.getByTestId("drawer-agreements").click();
  await expect(page.locator(".agreements-page")).toBeVisible();
}
async function send(page: Page, placeholder: string, text: string) {
  await page.getByPlaceholder(placeholder).fill(text);
  await page.getByTestId("conversation-send").click();
}
async function register(request: APIRequestContext, account: { name: string; email: string; language: string }) {
  const response = await request.post("/api/auth/register", { data: { ...account, password: PASSWORD } });
  expect(response.status(), await response.text()).toBe(201);
}
async function postJson(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}
