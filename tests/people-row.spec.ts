import { expect, test } from "@playwright/test";

// Founder 11-09: someone single getting to know several people must find them without being taught. The people show up by
// themselves at the top of Just me, a 已为 X 建档 line opens the person's card, and comparing asks Pinky in the chat.
test("the people someone is getting to know sit at the top of Just me, open into their cards and are compared by Pinky", async ({ page, context }) => {
  // The welcome tour is covered by couple-onboarding.spec.ts; here it would only sit in front of the row under test.
  await context.addInitScript(() => localStorage.setItem("toward-us:onboarded", "1"));
  await context.request.post("/api/auth/register", { data: { name: "People tester", email: `people-ui-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const at = new Date().toISOString();
  const session = { id: "people-session", language: "zh", timezone: "UTC", version: 1, messages: [
    { id: "m1", role: "user", text: "他约我爬山，我怎么回？", itemId: "m1", createdAt: at },
    { id: "m2", role: "assistant", text: "他很主动，想去就直接答应。", createdAt: at },
    { id: "m3", role: "assistant", kind: "noted", personId: "p-jie", text: "已为 阿杰 建档", createdAt: at },
  ] };
  const people = [
    { id: "p-jie", name: "阿杰", aliases: ["阿杰"], archived: false, lastSeenAt: at, facts: 1 },
    { id: "p-lily", name: "Lily", aliases: ["Lily"], archived: false, lastSeenAt: at, facts: 0 },
  ];
  const sent: string[] = [];
  await page.route("**/api/assistant/sessions**", async (route) => {
    const body = route.request().postDataJSON?.();
    if (body?.text) sent.push(body.text);
    await route.fulfill({ json: { session } });
  });
  await page.route(/\/api\/people(\?.*)?$/, (route) => route.fulfill({ json: { people } }));
  // 对比 is made by Pinky by itself (founder 11-09); the page only shows it.
  await page.route(/\/api\/people\/compare/, (route) => route.fulfill({ json: { status: "ready", stale: false, comparison: { overview: "Lily 主动、说到做到；阿杰 在等你的答案。", leaning: "p-lily", ask: "", people: [
    { id: "p-lily", name: "Lily", stage: "warming", going: "主动约第二次", watch: "", next: "周六见面" },
    { id: "p-jie", name: "阿杰", stage: "close", going: "很真诚", watch: "在等你的答案", next: "两周内给答案" }] } } }));
  await page.route("**/api/people/p-jie", (route) => route.fulfill({ json: { person: people[0], facts: [{ id: "f1", category: "likes", text: "爱爬山", quote: null }], history: [] } }));
  await page.goto("/");
  await expect(page.getByText("他很主动，想去就直接答应。")).toBeVisible();
  await expect(page.getByTestId("person-chip")).toHaveCount(2);
  await expect(page.getByTestId("people-compare")).toBeVisible();
  await page.getByTestId("person-noted").click();
  await expect(page.getByTestId("person-sheet")).toContainText("爱爬山");
  await page.getByTestId("person-compare").click();
  await expect(page.getByTestId("compare-overview")).toContainText("目前更倾向 Lily");
  await expect(page.getByTestId("compare-row")).toHaveCount(2);
  await expect(page.getByTestId("compare-page")).toContainText("在等你的答案");
  await page.getByTestId("compare-chat").click();
  await expect.poll(() => sent.join("\n")).toContain("帮我对比一下 阿杰、Lily");
});
