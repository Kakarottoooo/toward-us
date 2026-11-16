import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// The whole first run of a couple, each on their own phone (two browser contexts, so two separate sign-ins):
// A signs up and invites, B opens the link, sees who invited them and signs up, which joins them to A in the same step; they
// talk in Us for the first time, and
// the character one of them makes appears for both. A writes in Chinese, B uses the English interface.
// Accounts are synthetic and made fresh each run on the local test server (playwright.couple.config.ts).
const PASSWORD = "synthetic-couple-2026";
const PHONE = { width: 393, height: 852 };
const PET_PHOTO = fileURLToPath(new URL("../public/assets/brand/pinky-icon-512.png", import.meta.url));
const CJK = /[㐀-鿿]/;

test("a couple goes from invite to a shared conversation and character", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const accountA = { name: "小彼", email: `couple-a-${suffix}@example.invalid` };
  const accountB = { name: "Blue", email: `couple-b-${suffix}@example.invalid` };
  const a = await browser.newContext({ baseURL, viewport: PHONE });
  const b = await browser.newContext({ baseURL, viewport: PHONE });
  const pageA = await a.newPage(), pageB = await b.newPage();

  // 1. A signs up and creates the invite from the welcome tour.
  await pageA.goto("/");
  await pageA.getByTestId("start-button").click();
  await pageA.getByRole("button", { name: "还没有账号？创建一个" }).click();
  await signUp(pageA, accountA);
  await expect(pageA.getByTestId("onboarding")).toBeVisible();
  await pageA.getByTestId("onboarding-next").click();
  await pageA.getByTestId("onboarding-action").click(); // "邀请 TA 加入"
  await pageA.getByTestId("share-invite").click(); // makes the link, then shares it (or copies it without a share sheet)
  const code = (await pageA.locator(".invite-code strong").innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  // A's own material, which must never reach B.
  expect((await a.request.post("/api/memories", { data: { text: "A_PRIVATE_MEMORY 我其实有点担心见家长", allowPrivateAI: false, source: { type: "member" }, language: "zh" } })).ok()).toBe(true);
  expect((await a.request.post("/api/checkins", { data: { text: "A_PRIVATE_CHECKIN 今天有点累", kind: "checkin", mood: null, language: "zh" } })).ok()).toBe(true);

  // 2. B opens the invite link: a page that names A and says what Pinky is for them, in B's chosen language; then sign-up.
  await pageB.goto(`/?invite=${code}`);
  const landing = pageB.getByTestId("invite-landing");
  await landing.getByRole("button", { name: "EN", exact: true }).first().click();
  await expect(pageB.getByTestId("invite-landing-title")).toHaveText(`${accountA.name} invited you to Pinky`);
  await expect(landing.locator(".invite-landing-points")).not.toContainText(CJK);
  await expectLanguagesReachable(pageB);
  await pageB.screenshot({ path: testInfo.outputPath("b-landing-en.png") });
  // A's link was opened: A's waiting card can say so.
  await expect.poll(async () => Boolean((await getJson(a.request, "/api/auth/me")).pairing.invitation.openedAt)).toBe(true);
  await pageB.getByTestId("invite-join").click();
  await expect(pageB.getByTestId("register-name")).toBeVisible();
  // A taken email is explained in the interface language, not in the server's Chinese.
  await signUp(pageB, { name: accountB.name, email: accountA.email });
  await expect(pageB.getByRole("alert")).toHaveText("This email is already registered. Sign in instead.");
  await expect(pageB.locator("main.auth-content")).not.toContainText(CJK);
  await pageB.getByTestId("auth-email").fill(accountB.email);
  await pageB.getByTestId("auth-submit").click();

  // 3. Signing up joined A in the same step: no code to type, B lands in the conversation.
  await expect(pageB.getByTestId("conversation-screen")).toBeVisible();
  // Joining opens on Us, not on B's private channel; the channel does not stay in the address.
  await expect(pageB.getByRole("tab", { name: /^Us\b/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => new URL(pageB.url()).search).toBe("");

  // The two accounts are now one couple, for both of them.
  const meA = await getJson(a.request, "/api/auth/me"), meB = await getJson(b.request, "/api/auth/me");
  expect(meA.pairing.status).toBe("active");
  expect(meB.pairing.id).toBe(meA.pairing.id);
  expect(meB.pairing.members.map((member: { name: string }) => member.name).sort()).toEqual([accountA.name, accountB.name].sort());

  // 4. A's Us opens by itself once B has joined, as the invite promised: no "check connection" tap.
  await expect(pageA.getByTestId("conversation-invite")).toHaveCount(0);
  await expect(pageA.getByPlaceholder("发给你们俩…")).toBeVisible();
  // A took the tour before B joined, so "make your character" had no button then; it comes now, once, and the button works.
  const offer = pageA.getByTestId("onboarding");
  await expect(offer).toContainText("做你们的角色");
  await offer.getByTestId("onboarding-action").click(); // "现在就做"
  await expect(pageA.getByTestId("character-maker")).toBeVisible();
  // The back button says where it goes: straight back to the conversation it came from.
  await pageA.getByRole("button", { name: "对话" }).click();
  await expect(pageA.getByPlaceholder("发给你们俩…")).toBeVisible();
  await expect(pageA.getByTestId("onboarding")).toHaveCount(0);

  // 5. B makes the couple's character from the tour's last card.
  await expect(pageB.getByTestId("onboarding")).toBeVisible();
  for (let step = 0; step < 3; step += 1) await pageB.getByTestId("onboarding-next").click();
  await pageB.getByTestId("onboarding-action").click(); // "Make it now"
  await pageB.getByTestId("character-file").setInputFiles(PET_PHOTO);
  await pageB.getByTestId("character-share").click();
  await expect(pageB.getByTestId("character-maker").getByRole("status")).toHaveText("Done. It floats at the top of your conversation for both of you.");
  await pageB.getByRole("button", { name: "Chat" }).click();

  // 6. Their first words in Us reach each other, Pinky answers when called, and the character floats above for both.
  await expect(pageB.getByRole("tab", { name: /^Us\b/ })).toHaveAttribute("aria-selected", "true");
  await sendInUs(pageB, "Write to both…", "B_SHARED_HELLO Pinky, I'm here, finally joined!");
  await expect(pageA.getByText("B_SHARED_HELLO Pinky, I'm here, finally joined!")).toBeVisible();
  await expect(pageB.getByText("Pinky is unavailable right now. Please try again later.", { exact: false })).toBeVisible();
  await sendInUs(pageA, "发给你们俩…", "A_SHARED_REPLY 欢迎！Pinky 你好");
  await expect(pageB.getByText("A_SHARED_REPLY 欢迎！Pinky 你好")).toBeVisible();
  await expect.poll(async () => (await getJson(a.request, "/api/together")).conversation.messages.filter((message: { role: string }) => message.role === "agent").length).toBeGreaterThan(0);
  for (const page of [pageA, pageB]) await expectMascotShown(page);
  await pageA.screenshot({ path: testInfo.outputPath("a-us-zh.png") });
  await pageB.screenshot({ path: testInfo.outputPath("b-us-en.png") });

  // 7. Privacy: nothing of A's own reaches B, in what B's App is sent or on B's screens.
  for (const path of ["/api/auth/me", "/api/together", "/api/relationship/home", "/api/memories", "/api/checkins", "/api/character"]) {
    const response = await b.request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(await response.text(), path).not.toMatch(/A_PRIVATE_(MEMORY|CHECKIN)/);
  }
  await expect(pageB.locator("body")).not.toContainText("A_PRIVATE");
  await pageB.getByRole("tab", { name: /^Just me/ }).click();
  await pageB.getByTestId("open-drawer").click();
  await pageB.getByTestId("drawer-moments").click();
  await expect(pageB.getByTestId("moments-page")).toBeVisible();
  await expect(pageB.locator("body")).not.toContainText("A_PRIVATE");
  // A still sees their own.
  expect(JSON.stringify(await getJson(a.request, "/api/memories"))).toContain("A_PRIVATE_MEMORY");

  await a.close(); await b.close();
});

async function signUp(page: Page, account: { name: string; email: string }) {
  await page.getByTestId("register-name").fill(account.name);
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
}
async function sendInUs(page: Page, placeholder: string, text: string) {
  const box = page.getByPlaceholder(placeholder);
  await box.fill(text);
  await page.getByTestId("conversation-send").click();
  await expect(page.getByText(text)).toBeVisible();
}
async function expectMascotShown(page: Page) {
  const image = page.getByTestId("couple-mascot").locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
}
/** Every language button on the screen sits inside the phone width, so ES stays tappable. */
async function expectLanguagesReachable(page: Page) {
  for (const name of ["ZH", "EN", "ES"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(PHONE.width);
  }
}
async function getJson(request: APIRequestContext, path: string) { const response = await request.get(path); expect(response.ok(), path).toBe(true); return response.json(); }
