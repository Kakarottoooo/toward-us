import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

test("two principals plan privately and complete a joint decision without leaking private data", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
  await register(a.request, { name: "小彼", email: `relationship-a-${suffix}@example.com` });
  await register(b.request, { name: "阿蓝", email: `relationship-b-${suffix}@example.com` });
  const invitation = await postJson(a.request, "/api/partner/invitations", {});
  await postJson(b.request, "/api/partner/accept", { code: invitation.pairing.invitation.code });

  const pageA = await a.newPage(); const pageB = await b.newPage();
  await pageA.goto("/"); await pageB.goto("/");
  await expect(pageA.getByTestId("dashboard-screen")).toBeVisible();
  await expect(pageB.getByTestId("dashboard-screen")).toBeVisible();
  await expect(pageA.getByText("属于两个人的共同关系 Agent", { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "EN", exact: true }).click();
  await expect(pageA.getByText("A shared relationship agent for two people", { exact: true })).toBeVisible();
  await expect(pageA.getByText("彼此", { exact: true })).toHaveCount(0);
  await pageA.getByRole("button", { name: "ES", exact: true }).click();
  await expect(pageA.getByText("Un agente compartido de relación para dos personas", { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "ZH", exact: true }).click();
  const tablet = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, storageState: await a.storageState() });
  const tabletPage = await tablet.newPage(); await tabletPage.goto("/"); await expect(tabletPage.getByTestId("dashboard-screen")).toBeVisible(); await expect(tabletPage.getByRole("navigation", { name: "共同空间导航" })).toBeVisible(); await tablet.close();
  await pageA.screenshot({ path: testInfo.outputPath("relationship-home-desktop.png"), fullPage: true });
  await pageB.screenshot({ path: testInfo.outputPath("relationship-home-mobile.png"), fullPage: true });

  await pageA.getByRole("button", { name: "计划", exact: true }).click();
  await pageA.getByLabel("名称").fill("我们认识的日子");
  await pageA.getByLabel("日期").fill("2025-06-18");
  await pageA.getByRole("button", { name: "添加", exact: true }).first().click();
  await expect(pageA.getByText("我们认识的日子", { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "私人准备" }).click();
  await pageA.getByLabel("新清单").fill("我们的愿望清单");
  await pageA.getByRole("button", { name: "创建", exact: true }).click();
  await pageA.getByLabel("项目").fill("藏起来的周年礼物");
  await pageA.getByLabel("只有我能看到的惊喜准备").check();
  await pageA.getByRole("button", { name: "添加", exact: true }).last().click();
  await expect(pageA.getByText("藏起来的周年礼物", { exact: true })).toBeVisible();

  await pageB.getByRole("button", { name: "计划", exact: true }).click();
  await expect(pageB.getByText("我们认识的日子", { exact: true })).toBeVisible();
  await expect(pageB.getByText("藏起来的周年礼物", { exact: true })).toHaveCount(0);
  const homeB = await getJson(b.request, "/api/relationship/home");
  expect(JSON.stringify(homeB)).not.toContain("藏起来的周年礼物");
  expect(homeB.graph.reminders).toHaveLength(0);

  await pageA.getByRole("button", { name: "决定", exact: true }).click();
  await pageA.getByLabel("需要决定的事情").fill("今年在哪里过春节");
  await pageA.getByRole("button", { name: "创建决定房间" }).click();
  await submitPerspective(pageA, "我希望去我的家人那里", "PRIVATE_TOKEN_A");
  await pageA.getByRole("button", { name: "允许共同 Agent 使用这段摘要" }).click();

  await pageB.getByRole("button", { name: "决定", exact: true }).click();
  await expect(pageB.getByRole("option", { name: "今年在哪里过春节" })).toBeAttached();
  await submitPerspective(pageB, "我希望轮流安排两边家庭", "PRIVATE_TOKEN_B");
  await pageB.getByRole("button", { name: "允许共同 Agent 使用这段摘要" }).click();

  await expect(pageA.getByRole("button", { name: "双方确认摘要后生成方案" })).toBeEnabled();
  await pageA.getByRole("button", { name: "双方确认摘要后生成方案" }).click();
  await expect(pageA.locator(".proposal-grid article")).toHaveCount(3);
  await pageA.locator(".proposal-grid article").first().getByRole("button", { name: "可以接受" }).click();
  await expect(pageB.locator(".proposal-grid article")).toHaveCount(3);
  await pageB.locator(".proposal-grid article").first().getByRole("button", { name: "可以接受" }).click();
  await expect(pageA.locator(".proposal-grid article").first().getByRole("button", { name: "以此起草 Agreement" })).toBeEnabled();
  await pageA.locator(".proposal-grid article").first().getByRole("button", { name: "以此起草 Agreement" }).click();
  await pageA.getByRole("button", { name: "批准当前版本" }).click();
  await pageB.getByRole("button", { name: "批准当前版本" }).click();
  await expect(pageA.getByRole("button", { name: "把决定变成 Commitment" })).toBeVisible();
  await pageA.getByRole("button", { name: "把决定变成 Commitment" }).click();
  await pageA.getByRole("button", { name: "确认我的部分完成" }).click();
  await pageB.getByRole("button", { name: "确认我的部分完成" }).click();

  const graphA = await getJson(a.request, "/api/relationship/home");
  expect(graphA.graph.commitments[0].status).toBe("completed");
  expect(graphA.graph.outcomes).toHaveLength(1);
  expect(JSON.stringify(graphA)).not.toContain("PRIVATE_TOKEN_B");
  expect(JSON.stringify(homeB)).not.toContain("PRIVATE_TOKEN_A");

  await a.close(); await b.close();
});

async function submitPerspective(page: Page, goal: string, privateToken: string) {
  await page.getByLabel("我希望得到什么").fill(goal);
  await page.getByLabel("为什么重要").fill("希望双方家庭都被尊重");
  await page.getByLabel("可以妥协").fill("可以分阶段或轮流安排");
  await page.getByLabel("完全私密，不进入共同 Agent").fill(privateToken);
  await page.getByRole("button", { name: "提交给我的私人 Agent" }).click();
  await expect(page.getByText("私人观点已保存；对方看不到原文。")).toBeVisible();
}

async function register(request: APIRequestContext, account: { name: string; email: string }) {
  const response = await request.post("/api/auth/register", { data: { ...account, password: "correct-horse-battery" } });
  expect(response.status()).toBe(201);
}

async function postJson(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { data }); expect(response.ok()).toBeTruthy(); return response.json();
}

async function getJson(request: APIRequestContext, path: string) {
  const response = await request.get(path); expect(response.ok()).toBeTruthy(); return response.json();
}
