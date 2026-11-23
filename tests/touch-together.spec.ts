import { expect, test, type Page } from "@playwright/test";

// 碰一碰 between two phones (founder 11-22): A touches, B is told at once wherever B is in the app and touches back
// from the banner; both see that their touches met. Synthetic accounts on the local test server (playwright.couple.config.ts).
const PASSWORD = "synthetic-couple-2026";
const PHONE = { width: 390, height: 844 };

test("a touch reaches the partner, who touches back from anywhere in the app", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport: PHONE }), b = await browser.newContext({ baseURL, viewport: PHONE });
  const pageA = await a.newPage(), pageB = await b.newPage();

  await pageA.goto("/");
  await pageA.getByTestId("start-button").click();
  await pageA.getByRole("button", { name: "ZH", exact: true }).click();
  await signUp(pageA, "百福", `touch-a-${suffix}@example.invalid`);
  await expect.poll(async () => Boolean((await (await a.request.get("/api/auth/me")).json().catch(() => ({})))?.user?.id), { timeout: 30_000 }).toBe(true);
  const invited = await pageA.evaluate(async () => (await fetch("/api/partner/invitations", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })).json());
  const code = invited.invitation?.code || invited.pairing?.invitation?.code;
  expect(code, JSON.stringify(invited)).toMatch(/^[A-Z0-9]{8}$/);
  await pageB.goto("/");
  await pageB.getByTestId("start-button").click();
  await signUp(pageB, "Blue", `touch-b-${suffix}@example.invalid`);
  await expect.poll(async () => Boolean((await (await b.request.get("/api/auth/me")).json().catch(() => ({})))?.user?.id), { timeout: 30_000 }).toBe(true);
  const accepted = await pageB.evaluate(async (c) => (await fetch("/api/partner/accept", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, adultConfirmed: true }) })).status, code);
  expect(accepted).toBeLessThan(300);
  for (const page of [pageB, pageA]) {
    await page.goto("/?channel=us");
    const agree = page.getByRole("button", { name: /^(Agree and continue|同意并继续)/ });
    await expect(agree.or(page.getByTestId("conversation-interaction")).first()).toBeVisible({ timeout: 30_000 });
    if (await agree.isVisible()) await agree.click();
    await expect(page.getByTestId("conversation-interaction")).toBeVisible({ timeout: 30_000 });
  }
  for (const page of [pageA, pageB]) {
    const tour = page.getByTestId("onboarding");
    if (await tour.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  }

  // A opens Touch & cards: B is in the app, and the sheet keeps one height on both tabs.
  await pageA.getByTestId("conversation-interaction").click();
  const panel = pageA.getByTestId("play-distance");
  await expect(panel.locator(".distance-presence")).toHaveText("Blue现在在 Ourever 里");
  const touchHeight = (await panel.boundingBox())!.height;
  await panel.getByRole("button", { name: "小卡" }).click();
  // Was a jump of 100+ px; a textarea measuring itself can still move it a few pixels.
  expect(Math.abs((await panel.boundingBox())!.height - touchHeight)).toBeLessThan(16);
  await panel.getByRole("button", { name: "碰一下" }).first().click();
  await panel.locator(".distance-touch .distance-action").click();
  await expect(panel.locator(".distance-touch [role=status]")).toHaveText("已经告诉Blue了，等 TA 回碰…");
  await pageA.screenshot({ path: testInfo.outputPath("a-waiting.png") });

  // B, in the conversation with no sheet open, gets the banner and touches back.
  const banner = pageB.getByTestId("touch-arrival");
  await expect(banner).toContainText("百福 touched you");
  await pageB.waitForTimeout(600);
  await pageB.screenshot({ path: testInfo.outputPath("b-banner.png") });
  await banner.getByRole("button", { name: "Touch back" }).click();
  await expect(pageB.getByTestId("touch-met")).toHaveText("You and 百福 touched");
  await pageB.screenshot({ path: testInfo.outputPath("b-met.png") });
  await expect(panel.locator(".distance-touch [role=status]")).toHaveText("你们碰到了。");
  await pageA.screenshot({ path: testInfo.outputPath("a-met.png") });
});

async function signUp(page: Page, name: string, email: string) {
  await page.getByTestId("register-name").fill(name);
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
}
