import { expect, test } from "@playwright/test";

// QA 11-26, a couple's first day: sign-up fields have names a screen reader reads, a refused clipboard explains that the
// link is ready instead of "didn't finish, try again", and once the partner joins the inviter is told who joined and led to Us.
const PHONE = { width: 393, height: 852 };
const PASSWORD = "synthetic-dayone-2026";

test("a couple's first day: named fields, a calm copy fallback, and the joined partner leads to Us", async ({ browser, baseURL }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport: PHONE, locale: "zh-CN" });
  // This phone has no share sheet and refuses the clipboard, like a locked-down browser.
  await a.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }, configurable: true });
  });
  const page = await a.newPage();
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await page.getByRole("textbox", { name: "你的称呼" }).fill("小林");
  await page.getByRole("textbox", { name: "邮箱" }).fill(`dayone-a-${suffix}@example.invalid`);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();

  await page.getByRole("button", { name: "邀请你的伴侣" }).last().click();
  await expect(page.getByText("链接已生成，但没能自动复制。")).toBeVisible();
  await expect(page.getByText("邀请操作未完成")).toHaveCount(0);
  const link = (await page.locator(".invite-manual-link span").innerText()).trim();
  const code = new URL(link).searchParams.get("invite");
  expect(code).toMatch(/^[A-Z0-9]{8}$/);

  const b = await browser.newContext({ baseURL });
  expect((await b.request.post("/api/auth/register", { data: { email: `dayone-b-${suffix}@example.invalid`, name: "River", password: PASSWORD, adultConfirmed: true } })).ok()).toBe(true);
  expect((await b.request.post("/api/partner/accept", { data: { code } })).ok()).toBe(true);

  await expect(page.getByText("River已加入，你们可以在「我们俩」里一起聊了。")).toBeVisible();
  await page.getByRole("button", { name: "去和River聊" }).click();
  await page.getByRole("button", { name: "同意并继续" }).click();
  await expect(page.getByRole("tab", { name: /我们俩/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByPlaceholder("发消息给River…")).toBeVisible();
  await a.close(); await b.close();
});
