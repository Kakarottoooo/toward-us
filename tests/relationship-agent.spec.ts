import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test("private Agent conversations become joint work only after explicit sharing", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
  await register(a.request, { name: "小彼", email: `relationship-a-${suffix}@example.com` });
  await register(b.request, { name: "阿蓝", email: `relationship-b-${suffix}@example.com` });
  const invitation = await postJson(a.request, "/api/partner/invitations", {});
  await postJson(b.request, "/api/partner/accept", { code: invitation.pairing.invitation.code });

  const pageA = await a.newPage(); const pageB = await b.newPage(); await pageA.goto("/"); await pageB.goto("/");
  await expect(pageA.getByTestId("dashboard-screen")).toBeVisible(); await expect(pageB.getByTestId("dashboard-screen")).toBeVisible();
  await expect(pageA.getByText("属于两个人，也尊重每个人的内心空间", { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "EN", exact: true }).click(); await expect(pageA.getByText("For both of you, with room to think alone", { exact: true })).toBeVisible(); await expect(pageA.getByText("彼此", { exact: true })).toHaveCount(0);
  await pageA.getByRole("button", { name: "ES", exact: true }).click(); await expect(pageA.getByText("Para ambos, con espacio para pensar a solas", { exact: true })).toBeVisible(); await pageA.getByRole("button", { name: "ZH", exact: true }).click();
  await pageA.screenshot({ path: testInfo.outputPath("relationship-home-desktop.png"), fullPage: true }); await pageB.screenshot({ path: testInfo.outputPath("relationship-home-mobile.png"), fullPage: true });

  await pageA.getByRole("button", { name: "计划", exact: true }).click(); await sendToPrivateAgent(pageA, "我想记住我们认识的日子，日期是 2025-06-18");
  await expect(pageA.getByText("AI 整理出的计划", { exact: true })).toBeVisible(); await pageA.getByRole("button", { name: "加入我们的共同计划" }).click();
  expect((await getJson(b.request, "/api/relationship/home")).graph.milestones).toHaveLength(0);
  await confirmPreview(pageA, "我们认识的日子", "记住我们的相识日。");
  await expect(pageA.getByText("计划已加入共同空间。", { exact: true })).toBeVisible();
  expect((await getJson(b.request, "/api/relationship/home")).graph.milestones).toHaveLength(1);

  await pageA.getByRole("button", { name: "决定", exact: true }).click(); await sendToPrivateAgent(pageA, "PRIVATE_TOPIC_A：我在想今年春节去哪里，我希望家人被尊重，也可以轮流安排。"); await expect(pageA.getByText("AI 整理出的可分享观点", { exact: true })).toBeVisible(); await pageA.locator(".private-agent-workspace").screenshot({ path: testInfo.outputPath("decision-agent-desktop.png") });
  const beforeShare = await getJson(b.request, "/api/relationship/home"); expect(beforeShare.graph.issues).toHaveLength(0); expect(beforeShare.graph.privateAgentThreads).toHaveLength(0); expect(JSON.stringify(beforeShare)).not.toContain("PRIVATE_TOPIC_A");
  await pageA.getByRole("button", { name: "分享给另一半，问问 TA 的意见" }).click();
  expect((await getJson(b.request, "/api/relationship/home")).graph.issues).toHaveLength(0);
  await confirmPreview(pageA, "春节去哪里", "我希望家人被尊重，也愿意轮流安排。");
  await expect(pageA.getByText("你已主动分享；现在等待对方独立思考。", { exact: true })).toBeVisible(); await expect.poll(async () => (await getJson(b.request, "/api/relationship/home")).graph.issues.length).toBe(1);
  expect(JSON.stringify(await getJson(b.request, "/api/relationship/home"))).not.toContain("PRIVATE_TOPIC_A");

  await pageB.getByRole("button", { name: "决定", exact: true }).click(); await expect(pageB.getByRole("option").filter({ hasText: "春节去哪里" })).toBeAttached(); await sendToPrivateAgent(pageB, "B_PRIVATE_THOUGHT：我希望轮流安排两边家庭，也担心路上太累。"); await pageB.locator(".private-agent-workspace").screenshot({ path: testInfo.outputPath("decision-agent-mobile.png") });
  expect(JSON.stringify(await getJson(a.request, "/api/relationship/home"))).not.toContain("B_PRIVATE_THOUGHT"); await pageB.getByRole("button", { name: "分享给另一半，问问 TA 的意见" }).click();
  await confirmPreview(pageB, "春节去哪里", "我希望两边家庭轮流安排，也需要减少路途疲劳。");
  expect(JSON.stringify(await getJson(a.request, "/api/relationship/home"))).not.toContain("B_PRIVATE_THOUGHT");

  await expect(pageA.getByRole("button", { name: "双方确认摘要后生成方案" })).toBeEnabled(); await pageA.getByRole("button", { name: "双方确认摘要后生成方案" }).click(); await expect(pageA.locator(".proposal-grid article")).toHaveCount(3);
  await pageA.locator(".proposal-grid article").first().getByRole("button", { name: "可以接受" }).click(); await expect(pageB.locator(".proposal-grid article")).toHaveCount(3); await pageB.locator(".proposal-grid article").first().getByRole("button", { name: "可以接受" }).click();
  await expect(pageA.locator(".proposal-grid article").first().getByRole("button", { name: "以此起草 Agreement" })).toBeEnabled(); await pageA.locator(".proposal-grid article").first().getByRole("button", { name: "以此起草 Agreement" }).click(); await pageA.getByRole("button", { name: "批准当前版本" }).click(); await pageB.getByRole("button", { name: "批准当前版本" }).click();
  await expect(pageA.getByRole("button", { name: "安排具体承诺", exact: true })).toBeVisible(); await pageA.getByRole("button", { name: "安排具体承诺", exact: true }).click();
  const plan = pageA.locator('[aria-label="承诺安排"]');
  await plan.getByRole("textbox", { name: "具体做什么", exact: true }).fill("我们分别确认周六上午的共同时间。");
  await plan.getByRole("combobox", { name: "谁负责", exact: true }).selectOption("both");
  await plan.getByLabel("到期时间", { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await plan.getByLabel("复盘时间", { exact: true }).fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  await expect(plan.getByRole("button", { name: "确认承诺安排", exact: true })).toBeDisabled();
  await plan.getByRole("checkbox").check(); await plan.getByRole("button", { name: "确认承诺安排", exact: true }).click();
  expect((await getJson(a.request, "/api/relationship/home")).graph.commitments[0].status).toBe("awaiting_confirmations");
  await pageB.getByRole("button", { name: "我确认自己的责任和日期", exact: true }).click();
  await pageA.getByRole("button", { name: "确认我的部分完成", exact: true }).click();
  expect((await getJson(a.request, "/api/relationship/home")).graph.commitments[0].status).toBe("active");
  await pageB.getByRole("button", { name: "确认我的部分完成", exact: true }).click();
  const graphA = await getJson(a.request, "/api/relationship/home"); expect(graphA.graph.commitments[0].status).toBe("completed"); expect(graphA.graph.outcomes).toHaveLength(1); expect(graphA.graph.summaries.some((item: { text?: string }) => item.text === "我希望两边家庭轮流安排，也需要减少路途疲劳。")).toBe(true);
  await a.close(); await b.close();
});

async function sendToPrivateAgent(page: Page, text: string) { const composer = page.getByPlaceholder("说说你正在想什么…"); await composer.fill(text); await composer.press("Enter"); await expect(page.locator(".private-agent-messages .agent-message").last()).toBeVisible(); }
async function confirmPreview(page: Page, title: string, summary: string) {
  const preview = page.getByRole("region", { name: "确认分享内容", exact: true });
  await preview.getByRole("textbox", { name: "标题", exact: true }).fill(title);
  await preview.getByRole("textbox", { name: "确认后的摘要", exact: true }).fill(summary);
  await preview.getByRole("button", { name: "确认并分享这段内容", exact: true }).click();
  await expect(preview).toHaveCount(0);
}
async function register(request: APIRequestContext, account: { name: string; email: string }) { const response = await request.post("/api/auth/register", { data: { ...account, password: "correct-horse-battery" } }); expect(response.status()).toBe(201); }
async function postJson(request: APIRequestContext, path: string, data: unknown) { const response = await request.post(path, { data }); expect(response.ok()).toBeTruthy(); return response.json(); }
async function getJson(request: APIRequestContext, path: string) { const response = await request.get(path); expect(response.ok()).toBeTruthy(); return response.json(); }
