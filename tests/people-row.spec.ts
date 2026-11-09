import { expect, test, type Page } from "@playwright/test";

// Founder 11-09: someone single getting to know several people must find them without being taught. The people show up by
// themselves at the top of Just me, a 已为 X 建档 line opens the person's card, and 我的 TA 们 is a page of its own from the
// menu ("我要的是一整个功能界面……真实的情况是很复杂的", mockup B+C).
const at = new Date().toISOString();
const people = [
  { id: "p-jie", name: "阿杰", aliases: ["阿杰"], archived: false, lastSeenAt: at, facts: 1, stage: "close", previousStage: "warming", stageAt: at },
  { id: "p-lily", name: "Lily", aliases: ["Lily"], archived: false, lastSeenAt: at, facts: 0, stage: "risk", previousStage: "warming", stageAt: at },
];
const level = (value: string, label: string) => ({ level: value, label });
const row = (id: string, name: string, stage: string) => ({ id, name, stage, summary: id === "p-jie" ? "两周内要给他答案" : "找你借两千", view: `${name} 的看法`, going: "很真诚", watch: id === "p-lily" ? "开始谈钱" : "", next: "约下一次", feeling: "", traits: [{ text: "说话直接", tone: "good" }], unknowns: ["以后想在哪座城市生活？"],
  signals: { initiative: level("high", "很主动"), reliability: level("high", "做到"), honesty: level(id === "p-lily" ? "risk" : "high", id === "p-lily" ? "要当心" : "坦诚"), fit: level("unknown", "未知"), feeling: level("mid", "开心") },
  fit: [{ want: "认真想长期", verdict: id === "p-jie" ? "yes" : "unknown", evidence: id === "p-jie" ? "“我们现在算什么”" : "还没看到" }] });
const reading = { overview: "阿杰 主动又坦诚；Lily 开始谈钱。", leaning: "p-jie", decision: "按你想要的，阿杰最符合，决定由你。", ask: "", todos: [{ id: "p-jie", when: "13 天内", text: "给阿杰一个答案" }], suggestedWants: [], people: [row("p-jie", "阿杰", "close"), row("p-lily", "Lily", "risk")] };

async function signIn(page: Page, context: import("@playwright/test").BrowserContext, sent: string[], wants: Array<{ id: string; kind: string; text: string }>) {
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
  await page.route(/\/api\/people\/board/, (route) => route.fulfill({ json: { status: "ready", stale: false, reading, people, wants, feed: [{ personId: "p-jie", name: "阿杰", text: "2026-11-09 问我们现在算什么" }] } }));
  await page.route(/\/api\/people\/wants/, async (route) => { wants.splice(0, wants.length, ...route.request().postDataJSON().wants); await route.fulfill({ json: { wants } }); });
  await page.route(/\/api\/people\/p-jie(\?.*)?$/, (route) => route.fulfill({ json: { person: people[0], facts: [{ id: "f1", category: "likes", text: "爱爬山", quote: null }], history: [{ id: "h1", category: "history", text: "2026-11-09 问我们现在算什么", quote: null }], read: reading.people[0],
    numbers: { messages: { me: 40, them: 60 }, starts: { me: 3, them: 5 }, replyMinutes: { me: 25, them: 4 }, longestSilence: 2, monthly: [{ month: "2026-10", me: 20, them: 30 }, { month: "2026-11", me: 20, them: 30 }] } } }));
}

test("the people someone is getting to know sit at the top of Just me and open into their cards and their full page", async ({ page, context }) => {
  const sent: string[] = [];
  await signIn(page, context, sent, []);
  await page.goto("/");
  await expect(page.getByText("他很主动，想去就直接答应。")).toBeVisible();
  await expect(page.getByTestId("person-chip")).toHaveCount(2);
  await page.getByTestId("person-noted").click();
  await expect(page.getByTestId("person-sheet")).toContainText("爱爬山");
  await page.getByTestId("person-full").click();
  await expect(page.getByTestId("person-page")).toContainText("阿杰 的看法");
  await expect(page.getByTestId("person-numbers")).toContainText("TA 63%");
  await page.getByTestId("person-talk").click();
  await expect(page.getByTestId("conversation-input")).toHaveValue("关于 阿杰，");
});

test("我的 TA 们 opens from the menu with everyone read by Pinky, compared side by side and against what the member wants", async ({ page, context }) => {
  const sent: string[] = [], wants: Array<{ id: string; kind: string; text: string }> = [];
  await signIn(page, context, sent, wants);
  await page.goto("/");
  await page.getByTestId("open-drawer").click();
  await expect(page.getByTestId("drawer-people")).toContainText("1");
  await page.getByTestId("drawer-people").click();
  // 总览: what to do now, everyone by where they stand, who moved this week.
  await expect(page.getByTestId("people-todos")).toContainText("给阿杰一个答案");
  await expect(page.getByTestId("lane-close")).toContainText("两周内要给他答案");
  await expect(page.getByTestId("lane-risk")).toContainText("在升温 → 要当心");
  // 对比: the read, the table, the decision and what to find out next.
  await page.getByTestId("people-tab-compare").click();
  await expect(page.getByTestId("people-overview")).toContainText("目前更倾向 阿杰");
  await expect(page.getByTestId("people-matrix")).toContainText("要当心");
  await expect(page.getByTestId("people-page")).toContainText("如果今天就要决定");
  // 我想要的: one added, then each person is held against it.
  await page.getByTestId("people-tab-wants").click();
  await page.getByTestId("people-want-input").fill("认真想长期");
  await page.getByTestId("people-want-add").click();
  await expect.poll(() => wants.map((want) => `${want.kind}:${want.text}`).join()).toBe("must:认真想长期");
  await expect(page.getByTestId("people-want")).toHaveText(/认真想长期/);
  await page.getByTestId("people-tab-compare").click();
  await expect(page.getByTestId("people-fit")).toContainText("“我们现在算什么”");
  await page.getByTestId("people-ask").click();
  await expect(page.getByTestId("conversation-input")).toHaveValue("帮我对比一下 阿杰、Lily，谁更适合我？");
});
