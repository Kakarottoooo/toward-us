import { expect, test } from "@playwright/test";

// Founder 11-09: no lightbulb button; suggestions show when the app has just been opened and are gone once the person
// starts using it ("一般刚打开 APP 的时候可以出现，只要开始使用了之后就会消失掉建议"). Asking Pinky in words still works.
test("suggestions show on opening the app, with no bulb, and stay gone once the person starts typing", async ({ page, context }) => {
  await context.request.post("/api/auth/register", { data: { aiConsent: true, name: "Ideas tester", email: `ideas-ui-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const at = new Date().toISOString();
  const session = { id: "ideas-session", language: "zh", timezone: "UTC", version: 1, messages: [
    { id: "m1", role: "user", text: "她说我不在乎她", itemId: "m1", createdAt: at },
    { id: "m2", role: "assistant", text: "先接住她的感受。", createdAt: at },
  ] };
  await page.route("**/api/assistant/sessions**", (route) => route.fulfill({ json: { session } }));
  await page.route("**/api/suggestions**", (route) => route.fulfill({ json: { suggestions: ["她这句话什么意思？", "帮我回她", "周末去哪约会"], reasons: [] } }));
  await page.goto("/");
  await expect(page.getByText("先接住她的感受。")).toBeVisible();
  await expect(page.getByTestId("composer-ideas")).toBeVisible();
  await expect(page.getByTestId("show-ideas")).toHaveCount(0);
  const input = page.getByTestId("conversation-input");
  await input.fill("她");
  await expect(page.getByTestId("composer-ideas")).toHaveCount(0);
  await input.fill("");
  await expect(page.getByTestId("composer-ideas")).toHaveCount(0);
});
