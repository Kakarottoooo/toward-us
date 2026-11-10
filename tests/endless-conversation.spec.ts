import { expect, test } from "@playwright/test";

// Memory plan (11-09): a long conversation never fills up; its older messages wait in pages and load on request.
test("earlier messages of a long conversation load above the newest ones", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("toward-us:onboarded", "1"));
  await context.request.post("/api/auth/register", { data: { name: "Long talker", email: `long-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const at = new Date().toISOString();
  const session = { id: "long-session", language: "zh", timezone: "UTC", version: 1, earlierPages: 1, messages: [
    { id: "n1", role: "user", text: "最新的一句", itemId: "n1", createdAt: at },
    { id: "n2", role: "assistant", text: "最新的回答", createdAt: at },
  ] };
  await page.route(/\/api\/assistant\/sessions\/long-session\/earlier/, (route) => route.fulfill({ json: { messages: [{ id: "o1", role: "user", text: "三个月前说的话", createdAt: at }], page: 1, pages: 1 } }));
  await page.route("**/api/assistant/sessions**", (route) => route.request().url().includes("/earlier") ? route.fallback() : route.fulfill({ json: { session } }));
  await page.goto("/");
  await expect(page.getByText("最新的回答")).toBeVisible();
  await page.getByTestId("earlier-me").click();
  await expect(page.getByText("三个月前说的话")).toBeVisible();
  await expect(page.getByTestId("earlier-me")).toHaveCount(0, { timeout: 5000 });
});
