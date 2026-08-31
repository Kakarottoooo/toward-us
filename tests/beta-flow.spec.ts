import { expect, test } from "@playwright/test";

test("two accounts pair, mediate, confirm together, and review history", async ({ browser, page }) => {
  const suffix = Date.now();
  const accountA = { name: "小彼", email: `toward-us-a-${suffix}@example.com`, password: "correct-horse-battery" };
  const accountB = { name: "阿蓝", email: `toward-us-b-${suffix}@example.com`, password: "correct-horse-battery" };

  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await screenshotDevice(page, "qa/beta-login-implementation.png");

  const registerA = await page.context().request.post("/api/auth/register", { data: accountA });
  expect(registerA.status()).toBe(201);
  await page.reload();
  await expect(page.getByRole("heading", { name: "邀请伴侣" })).toBeVisible();
  await page.getByRole("button", { name: "生成伴侣邀请" }).click();
  const invitationCode = (await page.locator(".invite-code-panel strong").innerText()).trim();

  const contextB = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 1400, height: 1200 } });
  const pageB = await contextB.newPage();
  const registerB = await contextB.request.post("/api/auth/register", { data: accountB });
  expect(registerB.status()).toBe(201);
  const accept = await contextB.request.post("/api/partner/accept", { data: { code: invitationCode } });
  expect(accept.status()).toBe(200);

  await page.getByRole("button", { name: "检查是否已加入" }).click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  await screenshotDevice(page, "qa/beta-dashboard-implementation.png");
  await page.getByRole("button", { name: "开始一次调解" }).click();
  await page.getByRole("button", { name: /两台设备/ }).click();
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.getByTestId("room-screen")).toBeVisible();
  const roomCode = (await page.locator(".room-header strong").innerText()).trim();

  await pageB.goto("/");
  await expect(pageB.getByTestId("dashboard-screen")).toBeVisible();
  await pageB.getByPlaceholder("六位房间码").fill(roomCode);
  await pageB.getByTestId("join-active-room").click();
  await expect(pageB.getByTestId("room-screen")).toBeVisible();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();

  await page.getByPlaceholder("说说你看到的事实、感受或需要…").fill("我希望我们今天确定一个讨论结婚时间的日期。");
  await page.locator(".send-button").click();
  await pageB.getByPlaceholder("说说你看到的事实、感受或需要…").fill("我愿意讨论，但希望先把预算和准备事项写清楚。");
  await pageB.locator(".send-button").click();
  await expect(page.getByText("我愿意讨论，但希望先把预算和准备事项写清楚。")).toBeVisible();

  await page.getByTestId("room-screen").getByRole("button", { name: "请 AI 加入" }).click();
  await expect(page.getByTestId("room-screen")).toBeVisible();
  await expect(page.getByTestId("room-ai-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".analysis-tabs").getByRole("button", { name: "共同结论" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".analysis-tabs").getByRole("button", { name: "共同结论" }).click();
  await expect(page.getByText("确认保存为共同复盘", { exact: true })).toBeVisible();
  await screenshotDevice(page, "qa/formal-room-inline-analysis-desktop.png");
  await page.getByText("确认保存为共同复盘", { exact: true }).click();
  await expect(page.getByText("我已确认，等待伴侣", { exact: true })).toBeVisible();

  await expect(pageB.getByTestId("room-ai-panel")).toBeVisible({ timeout: 20_000 });
  await pageB.locator(".analysis-tabs").getByRole("button", { name: "共同结论" }).click();
  await pageB.getByText("确认保存为共同复盘", { exact: true }).click();
  await expect(pageB.getByText("双方已确认并归档", { exact: true })).toBeVisible();

  await expect(page.getByText("双方已确认并归档", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("双方已确认并归档", { exact: true }).click();
  await expect(page.getByText("当时的表达", { exact: true })).toBeVisible();
  await screenshotDevice(page, "qa/beta-history-detail-implementation.png");
  await page.locator(".history-detail .simple-header button").click();
  await expect(page.getByRole("heading", { name: "我们的复盘" })).toBeVisible();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await screenshotDevice(page, "qa/beta-history-implementation.png");
  await contextB.close();
});

async function screenshotDevice(page: import("@playwright/test").Page, path: string) {
  await page.getByTestId("mobile-cursor").evaluate((element: HTMLElement) => { element.style.display = "none"; });
  await page.getByTestId("device-screen").screenshot({ path });
}
