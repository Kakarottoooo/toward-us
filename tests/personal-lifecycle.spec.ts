import { expect, test } from "@playwright/test";

test("an unpaired person sees their memories, schedules a reminder and reaches settings from the drawer", async ({ page, context }, testInfo) => {
  const email = `personal-${Date.now()}@example.invalid`;
  expect((await context.request.post("/api/auth/register", { data: { name: "Solo", email, password: "synthetic-password-2026" } })).status()).toBe(201);
  // New entries come from the conversation; the Moments page shows them and offers a way back to Pinky.
  expect((await context.request.post("/api/checkins", { data: { text: "今天走了一小段路，舒服些了。", kind: "checkin", mood: null, language: "zh" } })).ok()).toBe(true);
  expect((await context.request.post("/api/memories", { data: { text: "先休息十分钟，再开始谈事情。", allowPrivateAI: false, source: { type: "member" }, language: "zh" } })).ok()).toBe(true);
  await page.goto("/");
  // A first visit opens a short tour; it ends with the last card and does not come back.
  await expect(page.getByTestId("onboarding")).toBeVisible();
  for (let step = 0; step < 3; step += 1) await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await page.reload(); await page.getByTestId("conversation-screen").waitFor();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await page.getByTestId("open-drawer").click();
  await expect(page.getByTestId("drawer-invite")).toBeVisible();
  await page.getByTestId("drawer-moments").click();
  await expect(page.getByTestId("personal-screen")).toBeVisible();
  await expect(page.getByTestId("moments-page")).toContainText("舒服些了");
  await expect(page.getByTestId("moments-page")).not.toContainText("先休息十分钟");
  await page.getByRole("button", { name: "跟 Pinky 说一个回忆", exact: true }).click();
  await expect(page.getByTestId("conversation-input")).toHaveValue("帮我存一个回忆：");
  expect((await context.request.post("/api/reminders", { data: { title: "给自己一分钟", localDateTime: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T19:00`, timezone: "UTC", frequency: "once", target: { kind: "reminders" } } })).ok()).toBe(true);
  await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-upcoming").click();
  await expect(page.locator(".reminders-form")).toHaveCount(0);
  await expect(page.getByTestId("upcoming-year").getByText("给自己一分钟", { exact: true }).first()).toBeVisible();
  await page.getByTestId("back-to-conversation").click();
  await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-settings").click();
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  // What Pinky remembers lives in Settings, apart from the Moments the person looks at.
  await page.getByTestId("settings-memory").click();
  await expect(page.locator(".memory-workspace .memory-text")).toContainText("先休息十分钟");
  await page.getByTestId("back-to-conversation").click();
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const language of ["ZH", "EN", "ES"]) {
    const button = page.getByRole("button", { name: language, exact: true });
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: testInfo.outputPath("personal-privacy-mobile-es.png"), fullPage: true });
});
