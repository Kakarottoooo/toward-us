import { expect, test } from "@playwright/test";

test("an unpaired person keeps daily memories, schedules a reminder and reaches settings from the drawer", async ({ page, context }, testInfo) => {
  const email = `personal-${Date.now()}@example.invalid`;
  expect((await context.request.post("/api/auth/register", { data: { name: "Solo", email, password: "synthetic-password-2026" } })).status()).toBe(201);
  await page.goto("/");
  await page.getByTestId("open-drawer").click();
  await expect(page.getByTestId("drawer-invite")).toBeVisible();
  await page.getByTestId("drawer-moments").click();
  await expect(page.getByTestId("personal-screen")).toBeVisible();
  await page.getByLabel("用自己的话说一句", { exact: true }).fill("今天走了一小段路，舒服些了。");
  await page.getByRole("button", { name: "只为自己保存", exact: true }).click();
  await expect(page.locator(".checkin-workspace .memory-text")).toContainText("舒服些了");
  await page.getByLabel("有什么值得下次记得？", { exact: true }).fill("先休息十分钟，再开始谈事情。");
  const memories = page.locator('.memory-workspace[aria-labelledby="memory-title"]');
  await expect(memories.getByRole("checkbox").first()).not.toBeChecked();
  await memories.getByRole("button", { name: "存为私人记忆", exact: true }).click();
  await expect(memories.locator(".memory-text")).toContainText("先休息十分钟");
  await page.getByTestId("back-to-conversation").click();
  await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-upcoming").click();
  await page.getByLabel("提醒自己什么", { exact: true }).fill("给自己一分钟");
  await page.getByLabel("当地日期与时间", { exact: true }).fill(`${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T19:00`);
  await page.getByRole("button", { name: "保存私人提醒", exact: true }).click();
  await expect(page.getByText("给自己一分钟", { exact: true })).toBeVisible();
  await page.getByTestId("back-to-conversation").click();
  await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-settings").click();
  await expect(page.locator(".privacy-workspace")).toBeVisible();
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
