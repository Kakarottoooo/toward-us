import { expect, test, type Page } from "@playwright/test";

test("two guests scan in, consent, mediate, and preserve the review together", async ({ browser }) => {
  const suffix = Date.now();
  const host = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 1400, height: 1200 } });
  const partner = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 1400, height: 1200 } });
  const hostPage = await host.newPage();
  const partnerPage = await partner.newPage();

  await hostPage.goto("/demo");
  await expect(hostPage.locator(".demo-entry")).toBeVisible();
  await hostPage.getByLabel("你的称呼").fill("小红");
  await hostPage.getByRole("button", { name: "创建临时房间" }).click();
  await expect(hostPage.locator(".demo-invite")).toBeVisible();
  const roomCode = new URL(hostPage.url()).searchParams.get("room");
  expect(roomCode).toMatch(/^[A-Z0-9]{8}$/);
  await expect(hostPage.getByRole("button", { name: "发送邀请" })).toBeVisible();
  await expect(hostPage.locator(".demo-qr")).toHaveCount(0);
  await hostPage.getByRole("button", { name: "对方在身边？显示二维码" }).click();
  await expect(hostPage.locator(".demo-qr")).toBeVisible();
  await screenshotDevice(hostPage, "qa/demo-invite-final.png");

  await partnerPage.goto(`/j/${roomCode}`);
  await expect(partnerPage.locator(".demo-join")).toBeVisible();
  await partnerPage.getByLabel("你的称呼").fill("阿蓝");
  await partnerPage.getByRole("button", { name: "加入房间" }).click();
  await expect(partnerPage.locator(".demo-consent")).toBeVisible();
  await expect(hostPage.locator(".demo-consent")).toBeVisible();

  await hostPage.locator(".demo-consent-pair button:enabled").click();
  await partnerPage.locator(".demo-consent-pair button:enabled").click();
  await expect(hostPage.getByRole("button", { name: "开始表达" })).toBeEnabled();
  await expect(partnerPage.getByRole("button", { name: "开始表达" })).toBeEnabled();
  await hostPage.getByRole("button", { name: "开始表达" }).click();
  await partnerPage.getByRole("button", { name: "开始表达" }).click();

  await hostPage.getByPlaceholder("说说你看到的事实、感受或需要…").fill("我希望我们今天确定一个讨论结婚时间的日期。");
  await hostPage.locator(".send-button").click();
  await partnerPage.getByPlaceholder("说说你看到的事实、感受或需要…").fill("我愿意讨论，但希望先把预算和准备事项写清楚。");
  await partnerPage.locator(".send-button").click();
  await expect(hostPage.getByText("我愿意讨论，但希望先把预算和准备事项写清楚。")).toBeVisible();

  await hostPage.getByRole("button", { name: "请 AI 加入" }).click();
  await expect(hostPage.getByTestId("demo-room")).toBeVisible();
  await expect(hostPage.getByTestId("demo-ai-panel")).toBeVisible({ timeout: 60_000 });
  await expect(partnerPage.getByTestId("demo-ai-panel")).toBeVisible({ timeout: 20_000 });
  await expect(hostPage).toHaveURL(new RegExp(`/demo\\?room=${roomCode}$`));
  await hostPage.locator(".analysis-tabs").getByRole("button", { name: "共同反馈" }).click();
  await partnerPage.locator(".analysis-tabs").getByRole("button", { name: "共同反馈" }).click();
  await expect(hostPage.getByRole("heading", { name: "想把这次体验留下来吗？" })).toBeVisible({ timeout: 60_000 });
  await screenshotDevice(hostPage, "qa/demo-room-inline-analysis-desktop.png");
  await hostPage.setViewportSize({ width: 390, height: 844 });
  await screenshotDevice(hostPage, "qa/demo-room-inline-analysis-mobile.png");
  await hostPage.setViewportSize({ width: 1400, height: 1200 });

  expect((await host.request.post("/api/auth/register", { data: { name: "小红", email: `demo-host-${suffix}@example.com`, password: "correct-horse-battery" } })).status()).toBe(201);
  expect((await partner.request.post("/api/auth/register", { data: { name: "阿蓝", email: `demo-partner-${suffix}@example.com`, password: "correct-horse-battery" } })).status()).toBe(201);
  await hostPage.reload();
  await partnerPage.reload();
  await hostPage.locator(".analysis-tabs").getByRole("button", { name: "共同反馈" }).click();
  await partnerPage.locator(".analysis-tabs").getByRole("button", { name: "共同反馈" }).click();
  await expect(hostPage.getByRole("button", { name: "确认保存我的这一侧" })).toBeVisible();
  await expect(partnerPage.getByRole("button", { name: "确认保存我的这一侧" })).toBeVisible();
  await hostPage.getByRole("button", { name: "确认保存我的这一侧" }).click();
  await partnerPage.getByRole("button", { name: "确认保存我的这一侧" }).click();
  await expect(hostPage.getByRole("heading", { name: "双方已确认，这次体验已经进入共同历史。" })).toBeVisible({ timeout: 20_000 });
  await expect(partnerPage.getByRole("heading", { name: "双方已确认，这次体验已经进入共同历史。" })).toBeVisible({ timeout: 20_000 });

  await hostPage.getByRole("button", { name: "进入正式空间" }).click();
  await expect(hostPage.getByTestId("dashboard-screen")).toBeVisible();

  await host.close();
  await partner.close();
});

test("one-device room keeps manual speaker selection and both sides in one conversation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "共用一台手机" }).click();
  await page.getByLabel("你的称呼").fill("小红");
  await page.getByLabel("对方的称呼").fill("阿蓝");
  await page.getByRole("button", { name: "创建临时房间" }).click();
  await page.locator(".demo-consent-pair button:enabled").first().click();
  await page.locator(".demo-consent-pair button:enabled").click();
  await page.getByRole("button", { name: "开始表达" }).click();

  const redSpeaker = page.getByRole("button", { name: "小红" });
  const blueSpeaker = page.getByRole("button", { name: "阿蓝" });
  await expect(redSpeaker).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("说说你看到的事实、感受或需要…").fill("这是我的看法。");
  await page.locator(".send-button").click();
  await blueSpeaker.click();
  await expect(blueSpeaker).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("说说你看到的事实、感受或需要…").fill("这是对方的看法。");
  await page.locator(".send-button").click();

  await expect(page.locator(".message.side-a").getByText("这是我的看法。")).toBeVisible();
  await expect(page.locator(".message.side-b").getByText("这是对方的看法。")).toBeVisible();
  await expect(page.getByText("无需模仿不同声音")).toBeVisible();
  await screenshotDevice(page, "qa/demo-room-speaker-selection-mobile.png");

  const composer = page.locator(".composer");
  const messageScroll = page.locator(".message-scroll");
  const textarea = page.getByPlaceholder("说说你看到的事实、感受或需要…");
  await textarea.click();
  await expect.poll(async () => { const box = await composer.boundingBox(); return Math.round((box?.y || 0) + (box?.height || 0)); }).toBeGreaterThanOrEqual(840);
  await expect(textarea).toHaveCSS("font-size", "16px");
  for (const control of [redSpeaker, blueSpeaker, page.locator(".send-button"), page.getByRole("button", { name: "请 AI 加入" })]) {
    const box = await control.boundingBox();
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(async () => Math.round((await messageScroll.boundingBox())?.height || 0)).toBeGreaterThan(120);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => Math.round((await messageScroll.boundingBox())?.height || 0)).toBeGreaterThan(80);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => Math.round((await messageScroll.boundingBox())?.width || 0)).toBeGreaterThanOrEqual(500);
});

async function screenshotDevice(page: Page, path: string) {
  await page.getByTestId("mobile-cursor").evaluate((element: HTMLElement) => { element.style.display = "none"; });
  await page.getByTestId("device-screen").screenshot({ path });
}
