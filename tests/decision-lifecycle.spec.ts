import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test("two people can report a worse attempt, keep one review private and approve revised terms on desktop and mobile", async ({ browser, baseURL }, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
  for (const [context, name] of [[a, "Alice"], [b, "Bob"]] as const) {
    expect((await context.request.post("/api/auth/register", { data: { name, email: `${name}-${suffix}@example.com`, password: "correct-horse-battery" } })).status()).toBe(201);
  }
  const invite = await post(a.request, "/api/partner/invitations", {});
  await post(b.request, "/api/partner/accept", { code: invite.pairing.invitation.code });
  const { issue } = await post(a.request, "/api/issues", { title: "Fictional weekend visit" });
  for (const context of [a, b]) {
    await post(context.request, `/api/issues/${issue.id}/perspectives`, { goal: "Short visits", shareableText: "Try an hour once a week", privateNotes: "PRIVATE_PERSPECTIVE_NOT_SHARED", language: "en" });
    await post(context.request, `/api/issues/${issue.id}/shareable-summary`, { text: "Try an hour once a week" });
  }
  const { proposals } = await post(a.request, `/api/issues/${issue.id}/generate-options`, { language: "en" });
  for (const context of [a, b]) await post(context.request, `/api/proposals/${proposals[0].id}/evaluations`, { value: "accept" });
  await post(a.request, "/api/agreements", { sourceIssueId: issue.id, proposalId: proposals[0].id, title: "Weekly visit", summary: "Try one hour", terms: ["Each person arranges a short visit"] });

  const pageA = await a.newPage(), pageB = await b.newPage();
  await Promise.all([pageA.goto("/"), pageB.goto("/")]);
  for (const page of [pageA, pageB]) await page.getByRole("button", { name: "决定", exact: true }).click();
  await pageA.getByRole("button", { name: "批准当前版本", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "我已批准此版本，等待对方" })).toBeDisabled();
  await pageB.getByRole("button", { name: "批准当前版本", exact: true }).click();
  await pageA.getByRole("button", { name: "安排具体承诺", exact: true }).click();
  const plan = pageA.locator('[aria-label="承诺安排"]');
  await plan.getByLabel("具体做什么", { exact: true }).fill("Each arrange a short visit");
  await plan.getByRole("combobox", { name: "谁负责", exact: true }).selectOption("both");
  await plan.getByLabel("到期时间", { exact: true }).fill("2026-01-01T12:00");
  await plan.getByLabel("复盘时间", { exact: true }).fill("2026-01-02T12:00");
  await expect(plan.getByRole("button", { name: "确认承诺安排" })).toBeDisabled();
  await plan.getByRole("checkbox").check();
  await plan.getByRole("button", { name: "确认承诺安排" }).click();
  await pageB.getByRole("button", { name: "我确认自己的责任和日期", exact: true }).click();
  await pageA.getByRole("button", { name: "现在复盘（未完成也可以）", exact: true }).click();
  const reviewA = pageA.locator(".decision-review-form"), reviewB = pageB.locator(".decision-review-form");
  await expect(reviewA.getByRole("button", { name: "提交我的真实复盘" })).toBeDisabled();
  await answerReview(pageA, { completed: "no", improvement: "worse", accept: "no", renegotiate: "yes", text: "The weekly visit exhausted me. I need once a month." });
  await reviewA.getByRole("checkbox").first().check();
  await expect(reviewA.getByRole("checkbox").last()).not.toBeChecked();
  await pageA.screenshot({ path: testInfo.outputPath("honest-review-desktop.png"), fullPage: true });
  await reviewA.getByRole("button", { name: "提交我的真实复盘" }).click();
  await answerReview(pageB, { completed: "yes", improvement: "same", accept: "yes", renegotiate: "no", text: "PRIVATE_REVIEW_B_DO_NOT_SHARE" });
  await expect(reviewB.getByRole("checkbox").first()).not.toBeChecked();
  await pageB.screenshot({ path: testInfo.outputPath("honest-review-mobile.png"), fullPage: true });
  await reviewB.getByRole("button", { name: "提交我的真实复盘" }).click();
  await pageA.getByRole("button", { name: "双方回答后形成共同结果" }).click();
  await expect(pageA.getByText("双方已完成复盘", { exact: true })).toBeVisible();
  await expect(pageA.getByText("PRIVATE_REVIEW_B_DO_NOT_SHARE", { exact: true })).toHaveCount(0);
  await expect(pageA.locator(".decision-agreement .status-line")).toHaveText("需要重新协商");

  await pageA.getByRole("button", { name: "EN", exact: true }).click();
  const discussion = pageA.getByRole("region", { name: "Shared conversation" });
  await discussion.getByPlaceholder("For example: This was exhausting. Could we try once a month?").fill("Could we try once a month instead? Keep each visit to one hour.");
  await discussion.getByRole("button", { name: "Send to shared conversation", exact: true }).click();
  await expect(discussion.getByText("Local draft (AI unavailable)", { exact: true })).toBeVisible();
  const editor = discussion.locator(".decision-editor");
  await editor.getByRole("textbox", { name: "Agreement title", exact: true }).fill("Monthly visit");
  await editor.getByRole("textbox", { name: "Shared summary", exact: true }).fill("Try one hour once per month");
  await editor.getByRole("textbox", { name: "Concrete terms (one per line)", exact: true }).fill("First Sunday of each month\nEach visit lasts at most one hour");
  await editor.getByRole("textbox", { name: "Unresolved questions (one per line)", exact: true }).fill("Agree the location each month");
  await editor.getByRole("checkbox").check();
  await editor.getByRole("button", { name: "Confirm draft for both approvals" }).click();
  await pageA.getByRole("button", { name: "Approve this version", exact: true }).click();
  await pageB.getByRole("button", { name: "批准当前版本", exact: true }).click();
  await expect(pageA.locator(".decision-agreement .status-line")).toHaveText("Active");
  await expect(pageA.locator(".decision-agreement")).toContainText("First Sunday of each month");
  await pageA.getByRole("button", { name: "ES", exact: true }).click();
  await expect(pageA.getByRole("heading", { name: "Seguir hablando juntos" })).toBeVisible();
  await pageA.screenshot({ path: testInfo.outputPath("revised-agreement-desktop.png"), fullPage: true });
  await pageB.screenshot({ path: testInfo.outputPath("revised-agreement-mobile.png"), fullPage: true });
  expect(await pageB.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const home = await (await a.request.get("/api/relationship/home")).json();
  expect(home.graph.agreements[0].status).toBe("active");
  expect(home.graph.agreements[0].terms).toEqual(["First Sunday of each month", "Each visit lasts at most one hour"]);
  expect(home.graph.outcomes[0].learnedPattern).toBeNull();
  expect(JSON.stringify(home)).not.toContain("PRIVATE_REVIEW_B_DO_NOT_SHARE");
  await a.close(); await b.close();
});

async function answerReview(page: Page, answers: { completed: string; improvement: string; accept: string; renegotiate: string; text: string }) {
  const form = page.locator(".decision-review-form");
  await form.getByRole("combobox", { name: "是否完成了自己负责的行动", exact: true }).selectOption(answers.completed);
  await form.getByRole("combobox", { name: "我现在仍然接受这份安排", exact: true }).selectOption(answers.accept);
  await form.getByRole("combobox", { name: "我希望重新协商", exact: true }).selectOption(answers.renegotiate);
  await form.getByRole("combobox", { name: "实际效果", exact: true }).selectOption(answers.improvement);
  await form.getByLabel("哪些没用或更难受（可留空）", { exact: true }).fill(answers.text);
}
async function post(request: APIRequestContext, path: string, data: unknown) { const response = await request.post(path, { data }); expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy(); return response.json(); }
