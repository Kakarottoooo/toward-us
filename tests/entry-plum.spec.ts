import { expect, test, type Browser } from "@playwright/test";

// Founder 11-26: a computer browser shows the same plum welcome as the phone (with Apple and Google sign-in), laid out
// for a wide window, and a partner's invite link opens on the same plum design instead of the old cream page.
const WIDE = { width: 1440, height: 900 }, SHORT = { width: 1280, height: 720 }, PHONE = { width: 393, height: 852 };
const CJK = /[㐀-鿿]/;

async function open(browser: Browser, baseURL: string | undefined, viewport: { width: number; height: number }, path = "/", locale = "zh-CN") {
  const context = await browser.newContext({ baseURL, viewport, locale });
  const page = await context.newPage();
  const errors: string[] = [];
  // Vite's dev hot-reload socket can fail when another local dev server holds its port; it is not part of the app.
  page.on("pageerror", (error) => { if (!/^WebSocket closed without opened/.test(error.message)) errors.push(error.message); });
  // Local runs have no Apple/Google keys; production does, so the welcome is checked with all three entries.
  await page.route("**/api/auth/oauth/providers", (route) => route.fulfill({ json: { google: true, apple: true } }));
  await page.goto(path);
  return { context, page, errors };
}

test("a computer browser gets the plum welcome with every sign-in, and it fits a short window", async ({ browser, baseURL }) => {
  for (const viewport of [WIDE, SHORT]) {
    const { context, page, errors } = await open(browser, baseURL, viewport);
    await expect(page.locator("html")).toHaveClass(/plum-entry/);
    await expect(page.getByTestId("desktop-home")).toHaveCount(0);
    for (const id of ["welcome-apple", "welcome-google", "start-button"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.locator(".welcome-support")).toBeVisible();
    // Two columns: the squirrel left of the headline, and nothing runs off the bottom of the window.
    const art = await page.locator(".plum-welcome .welcome-squirrel").boundingBox();
    const title = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(art!.x + art!.width).toBeLessThanOrEqual(title!.x);
    const signIn = await page.locator(".welcome-sign-in").boundingBox();
    expect(signIn!.y + signIn!.height).toBeLessThanOrEqual(viewport.height);
    // The language switch stays clear of the feedback button in the corner.
    const lang = await page.locator(".plum-welcome .language-switch").boundingBox();
    const feedback = await page.locator(".feedback-launch").boundingBox();
    if (feedback) expect(lang!.x + lang!.width).toBeLessThanOrEqual(feedback.x);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator(".plum-welcome")).not.toContainText(CJK);
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("register-name")).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("the phone welcome keeps its single column without the computer-only pieces", async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL, PHONE);
  await expect(page.getByTestId("start-button")).toBeVisible();
  for (const selector of [".welcome-support", ".welcome-points", ".welcome-wordmark"]) await expect(page.locator(selector)).toBeHidden();
  await context.close();
});

test("a partner's invite link opens on the plum page, on a phone and a computer", async ({ browser, baseURL }) => {
  const inviter = await browser.newContext({ baseURL });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const register = await inviter.request.post("/api/auth/register", { data: { email: `plum-${suffix}@example.invalid`, name: "阿青", password: "synthetic-plum-2026", adultConfirmed: true } });
  expect(register.ok()).toBe(true);
  const made = await (await inviter.request.post("/api/partner/invitations", { data: {} })).json();
  const code = made.pairing?.invitation?.code ?? made.invitation?.code;
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  for (const viewport of [PHONE, WIDE]) {
    const { context, page, errors } = await open(browser, baseURL, viewport, `/?invite=${code}`);
    const landing = page.locator(".invite-landing");
    await expect(landing).toHaveClass(/plum-invite/);
    await expect(page.getByTestId("invite-landing-title")).toHaveText("加入阿青的共同空间");
    await expect(landing.locator(".welcome-squirrel")).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(48, 14, 41)");
    for (const id of ["invite-join", "invite-sign-in", "invite-decline"]) await expect(page.getByTestId(id)).toBeVisible();
    await landing.getByRole("button", { name: "ES", exact: true }).click();
    await expect(page.getByTestId("invite-landing-title")).toHaveText("Únete a 阿青");
    await page.getByTestId("invite-join").click();
    await expect(page.getByTestId("register-name")).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
  await inviter.close();
});
