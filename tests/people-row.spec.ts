import { expect, test } from "@playwright/test";

// Founder 11-09: someone single getting to know several people must find them without being taught. The people show up by
// themselves at the top of Just me, a 已为 X 建档 line opens the person's card, and comparing asks Pinky in the chat.
test("the people someone is getting to know sit at the top of Just me and open into their cards", async ({ page, context }) => {
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
  await page.route("**/api/people", (route) => route.fulfill({ json: { people } }));
  await page.route("**/api/people/p-jie", (route) => route.fulfill({ json: { person: people[0], facts: [{ id: "f1", category: "likes", text: "爱爬山", quote: null }], history: [] } }));
  await page.goto("/");
  await expect(page.getByText("他很主动，想去就直接答应。")).toBeVisible();
  await expect(page.getByTestId("person-chip")).toHaveCount(2);
  await expect(page.getByTestId("people-compare")).toBeVisible();
  await page.getByTestId("person-noted").click();
  await expect(page.getByTestId("person-sheet")).toContainText("爱爬山");
  await page.getByTestId("person-compare").click();
  await expect.poll(() => sent.join("\n")).toContain("帮我对比一下 阿杰、Lily");
});
