import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Founder 11-09: someone single getting to know several people must find them without being taught. The people show up by
// themselves at the top of Just me, a 已为 X 建档 line opens the person's card, and 在了解的人 is a page of its own from the
// menu for seeing each relationship (third mockup: who is chasing whom, the member's patterns, each pair as a mirror).
const at = new Date().toISOString();
const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
const people = [
  { id: "p-jie", name: "阿杰", aliases: ["阿杰"], archived: false, lastSeenAt: at, createdAt: weekAgo, facts: 1, stage: "mutual", previousStage: null, stageAt: at, chase: "them", previousChase: null, chaseAt: at },
  { id: "p-qing", name: "晴晴", aliases: ["晴晴"], archived: false, lastSeenAt: at, createdAt: weekAgo, facts: 1, stage: "you_chase", previousStage: "mutual", stageAt: at, chase: "you_much", previousChase: "even", chaseAt: at },
  { id: "p-mia", name: "Mia", aliases: ["Mia"], archived: false, lastSeenAt: at, createdAt: weekAgo, facts: 1, stage: "risk", previousStage: null, stageAt: at, chase: "even", previousChase: null, chaseAt: at },
];
const row = (id: string, name: string, kind: string, chase: string) => ({ id, name, kind, chase, depth: "deep", shares: "even", view: kind === "risk" ? "她在谈钱、借钱，Pinky 不把它当作一段关系。" : `${name} 的看法`, self: "你在阿杰面前更松弛", quote: { text: "我想知道我们现在算什么", who: "them", date: "11-08" },
  traits: [{ text: "直接", evidence: "“我想知道我们现在算什么”" }], turns: [{ date: "11-09", up: true, title: "你坦白还在和别人聊", quote: "谢谢你跟我说实话", note: "" }] });
const reading = { insights: [{ headline: "你和主动、直接的人在一起最放松。", evidence: "阿杰先开口占 62%" }], people: [row("p-jie", "阿杰", "mutual", "them"), row("p-qing", "晴晴", "you_chase", "you_much"), row("p-mia", "Mia", "risk", "even")] };
const numbers = { me: { messages: 40, questions: 3, chars: 400 }, them: { messages: 60, questions: 7, chars: 700 }, starts: { me: 3, them: 5 }, replyMinutes: { me: 25, them: 4 }, lateNight: { me: 41, them: 39 }, longestSilence: 2, first: "2026-09-20", last: at.slice(0, 10) };

async function signIn(page: Page, context: BrowserContext, sent: string[]) {
  // The welcome tour is covered by couple-onboarding.spec.ts; here it would only sit in front of what is under test.
  await context.addInitScript(() => localStorage.setItem("toward-us:onboarded", "1"));
  await context.request.post("/api/auth/register", { data: { name: "People tester", email: `people-ui-${Date.now()}-${Math.random()}@example.invalid`, password: "synthetic-password-2026" } });
  const session = { id: "people-session", language: "zh", timezone: "UTC", version: 1, messages: [
    { id: "m1", role: "user", text: "他约我爬山，我怎么回？", itemId: "m1", createdAt: at },
    { id: "m2", role: "assistant", text: "他很主动，想去就直接答应。", createdAt: at },
    { id: "m3", role: "assistant", kind: "noted", personId: "p-jie", text: "已为 阿杰 建档", createdAt: at },
  ] };
  await page.route("**/api/assistant/sessions**", async (route) => {
    const body = route.request().postDataJSON?.();
    if (body?.text) sent.push(body.text);
    await route.fulfill({ json: { session } });
  });
  await page.route(/\/api\/people(\?.*)?$/, (route) => route.fulfill({ json: { people, alerts: 1 } }));
  await page.route(/\/api\/people\/board/, (route) => route.fulfill({ json: { status: "ready", stale: false, reading, numbers: { "p-jie": numbers, "p-qing": null, "p-mia": null }, people } }));
  await page.route(/\/api\/people\/p-jie(\?.*)?$/, (route) => route.fulfill({ json: { person: people[0], facts: [{ id: "f1", category: "likes", text: "爱爬山", quote: null }], history: [], read: reading.people[0], numbers } }));
}

test("the people someone is getting to know sit at the top of Just me and open into their cards and their full page", async ({ page, context }) => {
  const sent: string[] = [];
  await signIn(page, context, sent);
  await page.goto("/");
  await expect(page.getByText("他很主动，想去就直接答应。")).toBeVisible();
  await expect(page.getByTestId("person-chip")).toHaveCount(3);
  await page.getByTestId("person-noted").click();
  await expect(page.getByTestId("person-sheet")).toContainText("爱爬山");
  await page.getByTestId("person-full").click();
  await expect(page.getByTestId("person-page")).toContainText("你和阿杰");
  await expect(page.getByTestId("person-mirror")).toContainText("谁先开口");
  await expect(page.getByTestId("person-mirror")).toContainText("63%");
  await expect(page.getByTestId("person-turns")).toContainText("你坦白还在和别人聊");
  await expect(page.getByTestId("person-view")).toContainText("阿杰 的看法");
  await page.getByTestId("person-talk").click();
  await expect(page.getByTestId("conversation-input")).toHaveValue("关于 阿杰，");
});

test("在了解的人 opens from the menu: who is chasing whom, the member's patterns, and each relationship", async ({ page, context }) => {
  const sent: string[] = [];
  await signIn(page, context, sent);
  await page.goto("/");
  await page.getByTestId("open-drawer").click();
  await expect(page.getByTestId("drawer-people")).toContainText("在了解的人"); // founder 11-09: not "我的 TA 们"
  await expect(page.getByTestId("drawer-people")).toContainText("1");
  await page.getByTestId("drawer-people").click();
  await expect(page.getByTestId("balance-row")).toHaveCount(2); // Mia is not on the ruler
  await expect(page.getByTestId("people-balance")).toContainText("晴晴 从“双向奔赴”变成了“你在追”");
  await expect(page.getByTestId("people-balance")).toContainText("Mia 不在这里");
  await expect(page.getByTestId("people-insights")).toContainText("你和主动、直接的人在一起最放松");
  await expect(page.getByTestId("people-person")).toHaveCount(3);
  await expect(page.getByTestId("people-person").first()).toContainText("双向奔赴");
  await page.getByTestId("balance-row").first().click();
  await expect(page.getByTestId("person-page")).toContainText("你和阿杰");
  await page.getByTestId("person-back").click();
  await expect(page.getByTestId("people-balance")).toBeVisible();
});
