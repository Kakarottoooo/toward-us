import { expect, test } from "@playwright/test";

// Founder 11-09: "A 吧，一个 Pinky，三个阶段". While getting to know people the second tab is 在了解的人; when they tell Pinky
// they are together with one of them, Pinky asks once, puts the others away on 是的, and the tab becomes 我们俩 · 邀请 X.
test("getting to know people, then settling on one, changes the home without a mode switch", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("toward-us:onboarded", "1"));
  await context.request.post("/api/auth/register", { data: { name: "Stages tester", email: `stages-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const at = new Date().toISOString();
  const jie = { id: "p-jie", name: "阿杰", aliases: ["阿杰"], archived: false, lastSeenAt: at, facts: 1 };
  const lily = { id: "p-lily", name: "Lily", aliases: ["Lily"], archived: false, lastSeenAt: at, facts: 1 };
  let state = { people: [jie, lily], stage: "dating", chosen: null as typeof jie | null, alerts: 0 };
  const session = { id: "stages-session", language: "zh", timezone: "UTC", version: 1, messages: [
    { id: "m1", role: "user", text: "我和阿杰在一起了！", itemId: "m1", createdAt: at },
    { id: "m2", role: "assistant", text: "恭喜你们！", createdAt: at },
    { id: "m3", role: "assistant", kind: "together_ask", personId: "p-jie", text: "听起来你和阿杰确定了？", createdAt: at },
  ] };
  await page.route("**/api/assistant/sessions**", (route) => route.fulfill({ json: { session } }));
  await page.route(/\/api\/people(\?.*)?$/, (route) => route.fulfill({ json: state }));
  const chosen: unknown[] = [];
  await page.route(/\/api\/people\/p-jie\/choose/, async (route) => {
    chosen.push(route.request().postDataJSON());
    state = { people: [jie], stage: "chosen", chosen: jie, alerts: 0 };
    await route.fulfill({ json: { stage: "chosen", chosen: jie, person: jie } });
  });
  await page.goto("/");

  // Getting to know people: the second tab is 在了解的人, and the people sit at the top of Just me.
  await expect(page.getByTestId("tab-people")).toContainText("在了解的人");
  await expect(page.getByTestId("person-chip")).toHaveCount(2);

  // Pinky's one question, answered 是的: the sheet says what happens to the others and what 阿杰 will never see.
  await expect(page.getByTestId("together-ask")).toContainText("听起来你和阿杰确定了？");
  await page.getByTestId("together-yes").click();
  await expect.poll(() => JSON.stringify(chosen)).toContain('"chosen":true');
  await expect(page.getByTestId("together-sheet")).toContainText("其他 1 个人先收起来，不会删除");
  await expect(page.getByTestId("together-sheet")).toContainText("阿杰永远看不到他们");
  await page.getByTestId("together-later").click();

  // Settled on one: the tab is 我们俩 · 邀请阿杰, and the question is not asked again.
  await expect(page.getByRole("tab", { name: /我们俩/ })).toContainText("邀请阿杰");
  await expect(page.getByTestId("together-yes")).toHaveCount(0);
});
