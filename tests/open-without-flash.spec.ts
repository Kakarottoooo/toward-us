import { expect, test } from "@playwright/test";

// Founder 11-08: opening Pinky flashed several screens (the signed-out landing page, then an empty new-user chat) before the
// real conversation. A signed-in member must go from a plain background straight to their conversation, even when the
// network is slow.
test("a signed-in member opens straight into the conversation without flashing other screens", async ({ page, context }) => {
  await context.request.post("/api/auth/register", { data: { aiConsent: true, adultConfirmed: true, name: "Flash tester", email: `flash-ui-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const session = { id: "flash-session", language: "zh", timezone: "UTC", version: 1, messages: [
    { id: "m1", role: "user", text: "她说我不在乎她", itemId: "m1", createdAt: new Date().toISOString() },
    { id: "m2", role: "assistant", text: "先接住她的感受，再说你的安排。", createdAt: new Date().toISOString() },
  ] };
  const slow = (ms: number) => new Promise((done) => setTimeout(done, ms));
  await page.route("**/api/auth/me", async (route) => { await slow(800); await route.continue(); });
  await page.route("**/api/assistant/sessions**", async (route) => { await slow(800); await route.fulfill({ json: { session } }); });
  await page.addInitScript(() => {
    const seen = new Set<string>();
    const look = () => { for (const id of ["home-screen", "reply-coach-empty", "auth-screen"]) if (document.querySelector(`[data-testid="${id}"]`)) seen.add(id); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    Object.assign(window, { flashSeen: seen });
  });
  await page.goto("/");
  await expect(page.getByText("先接住她的感受，再说你的安排。")).toBeVisible();
  expect(await page.evaluate(() => [...(window as unknown as { flashSeen: Set<string> }).flashSeen])).toEqual([]);
});

// Founder 11-21: inside the app the status-bar and home-indicator bands stayed plum. The iOS shell paints them in the
// body colour and ignores a transparent body, so once signed in the body must report paper, not plum or transparent.
test("a signed-in member's page gives the iOS shell paper for the safe areas", async ({ page, context }) => {
  await context.request.post("/api/auth/register", { data: { aiConsent: true, adultConfirmed: true, name: "Band tester", email: `band-ui-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  await page.addInitScript(() => { (window as unknown as { Capacitor: object }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; });
  await page.goto("/");
  await expect(page.getByTestId("home-screen")).toBeHidden();
  await expect(page.locator("#root *").first()).toBeAttached();
  await expect(page.locator(".boot-splash")).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 239, 230)");
});
