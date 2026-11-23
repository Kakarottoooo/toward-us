import { expect, test, type Browser, type Page } from "@playwright/test";

// QA round 8 (iPhone width, 375–393pt): the floating feedback button and the couple's pet sat over the right edge of the Us
// thread, covering message text, the "…" message menus and the "Sent" receipt. Two synthetic accounts on the local test
// server (playwright.couple.config.ts) fill the thread, then every message box is checked against both floating boxes.
const PASSWORD = "synthetic-couple-2026";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function signUp(page: Page, name: string, email: string) {
  await page.getByTestId("register-name").fill(name);
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
}

async function pairedCouple(browser: Browser, baseURL: string | undefined, viewport: { width: number; height: number }) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport }), b = await browser.newContext({ baseURL, viewport });
  const pageA = await a.newPage(), pageB = await b.newPage();
  for (const [page, context, name] of [[pageA, a, "Avery"], [pageB, b, "Blue"]] as const) {
    await page.goto("/");
    await page.getByTestId("start-button").click();
    await signUp(page, name, `overlap-${name.toLowerCase()}-${suffix}@example.invalid`);
    await expect.poll(async () => Boolean((await (await context.request.get("/api/auth/me")).json().catch(() => ({})))?.user?.id), { timeout: 30_000 }).toBe(true);
  }
  const invited = await pageA.evaluate(async () => (await fetch("/api/partner/invitations", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })).json());
  const code = invited.invitation?.code || invited.pairing?.invitation?.code;
  const accepted = await pageB.evaluate(async (c) => (await fetch("/api/partner/accept", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, adultConfirmed: true }) })).status, code);
  expect(accepted).toBeLessThan(300);
  for (const page of [pageB, pageA]) {
    await page.goto("/?channel=us");
    const agree = page.getByRole("button", { name: /^(Agree and continue|同意并继续)/ });
    await expect(agree.or(page.getByTestId("conversation-interaction")).first()).toBeVisible({ timeout: 30_000 });
    if (await agree.isVisible()) await agree.click();
    await expect(page.getByTestId("conversation-interaction")).toBeVisible({ timeout: 30_000 });
    if (await page.getByTestId("onboarding").isVisible().catch(() => false)) await page.keyboard.press("Escape");
  }
  return { pageA, pageB, close: async () => { await a.close(); await b.close(); } };
}

async function say(page: Page, text: string) {
  await page.getByTestId("conversation-input").fill(text);
  await page.getByTestId("conversation-send").click();
  await expect(page.locator(".shared-reportable").filter({ hasText: text }).first()).toBeVisible();
}

for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
  test(`floating feedback button and pet stay clear of messages at ${viewport.width}pt`, async ({ browser, baseURL }, testInfo) => {
    const { pageA, pageB, close } = await pairedCouple(browser, baseURL, viewport);
    const long = "This is a longer message that runs all the way across the bubble so it reaches the right edge of the thread";
    for (let index = 0; index < 4; index++) {
      await say(pageA, `${long} (A${index})`);
      await say(pageB, `${long} (B${index})`);
    }
    await say(pageA, "ok");
    const page = pageA;
    // A fresh load: no focused box, so the pet is not stepping aside for the keyboard.
    await page.reload();
    await expect(page.getByTestId("conversation-interaction")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("floating-pet")).not.toHaveClass(/is-away/);
    await expect(page.getByTestId("feedback-entry")).toBeVisible();
    await expect(page.getByTestId("floating-pet")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`chat-${viewport.width}.png`) });
    const scroller = page.locator(".conversation-scroll");
    // Every scroll position: the top, the middle and the latest line.
    for (const position of [0, 0.5, 1]) {
      await scroller.evaluate((node, at) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * at; }, position);
      await page.waitForTimeout(150);
      const floating = [await page.getByTestId("feedback-entry").boundingBox(), await page.getByTestId("floating-pet").boundingBox()].filter(Boolean) as Box[];
      expect(floating).toHaveLength(2);
      const view = (await scroller.boundingBox())!;
      const content = await page.locator(".shared-reportable p, .shared-reportable button, .shared-reportable .message-receipt").evaluateAll((nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, text: (node.textContent || node.getAttribute("aria-label") || "").slice(0, 40) };
      }));
      for (const item of content) {
        // Only what is on screen inside the thread can be covered.
        if (item.y + item.height <= view.y || item.y >= view.y + view.height || !item.width) continue;
        for (const box of floating) expect(overlaps(item, box), `${JSON.stringify(item)} under ${JSON.stringify(box)} at scroll ${position}`).toBe(false);
      }
    }
    await close();
  });
}
