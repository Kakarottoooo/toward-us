import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

// Memory plan (11-09): a long conversation never fills up; its older messages wait in pages and load on request.
test("earlier messages of a long conversation load above the newest ones", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("toward-us:onboarded", "1"));
  await context.request.post("/api/auth/register", { data: { name: "Long talker", email: `long-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const at = new Date().toISOString();
  const session = { id: "long-session", language: "zh", timezone: "UTC", version: 1, earlierPages: 1, messages: [
    { id: "n1", role: "user", text: "最新的一句", itemId: "n1", createdAt: at },
    { id: "n2", role: "assistant", text: "最新的回答", createdAt: at },
  ] };
  await page.route(/\/api\/assistant\/sessions\/long-session\/earlier/, (route) => route.fulfill({ json: { messages: [{ id: "o1", role: "user", text: "三个月前说的话", createdAt: at }], page: 1, pages: 1 } }));
  await page.route("**/api/assistant/sessions**", (route) => route.request().url().includes("/earlier") ? route.fallback() : route.fulfill({ json: { session } }));
  await page.goto("/");
  await expect(page.getByText("最新的回答")).toBeVisible();
  await page.getByTestId("earlier-me").click();
  await expect(page.getByText("三个月前说的话")).toBeVisible();
  await expect(page.getByTestId("earlier-me")).toHaveCount(0, { timeout: 5000 });
});

// Real authenticated HTTP routes and a real browser; only the planner is deterministic. Model quality is evaluated
// separately by eval:memory. This fixture never opens a real account, environment file or dogfood store.
test.describe("recall navigation", () => {
  let directory: string, base: string, store: any, server: any, vite: any;
  test.use({ timezoneId: "UTC" });
  test.beforeAll(async () => {
    await mkdir(resolve("work"), { recursive: true });
    directory = await mkdtemp(resolve("work/recall-browser-"));
    store = await createFileStore(join(directory, "state.json"));
    const mediator = { planAssistantTurn: async (context: any) => ({ reply: `2025-03-12: You asked how to thank someone. I suggested a sapphire lantern. ${context.lookups?.[0]?.findings.match(/\[recall:[^\]]+\]/)?.[0] || ""}`, actions: [] }) };
    const app = createApiApp({ store, mediator });
    // Reuse Vite's source middleware so this spec also runs before the CI build step.
    const { createServer } = await import("vite");
    vite = await createServer({ root: process.cwd(), appType: "spa", server: { middlewareMode: true, hmr: false } });
    app.use(vite.middlewares);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.afterAll(async () => {
    await vite?.close();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  for (const width of [390, 1280]) for (const language of ["zh", "en", "es"]) test(`${width} ${language}: source, archive highlight and date jump`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addInitScript((language) => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", language); }, language);
    const registration = await context.request.post(`${base}/api/auth/register`, { data: { name: "Recall tester", email: `recall-${randomUUID()}@example.invalid`, password: "synthetic-password-2026" } });
    expect(registration.ok()).toBeTruthy();
    const { user } = await registration.json();
    const question = { id: randomUUID(), role: "user", text: "How should I thank someone?", createdAt: "2025-03-12T10:00:00.000Z" };
    const answer = { id: randomUUID(), role: "assistant", text: "Use a sapphire lantern and write three specific thank-you notes.", createdAt: "2025-03-12T10:01:00.000Z" };
    const record = createRelationshipRecord({ userId: user.id, relationshipId: null, visibility: "private", aiAccessScope: "private", intentType: "assistant", language, timezone: "UTC",
      earlier: [{ messages: [question, answer] }], messages: Array.from({ length: 110 }, (_, index) => ({ id: randomUUID(), role: index % 2 ? "assistant" : "user", text: `Recent ordinary message ${index}`, createdAt: "2026-11-01T10:00:00.000Z" })) });
    await store.createRelationshipRecord("privateAgentThreads", record);
    const recalled = await context.request.post(`${base}/api/assistant/sessions/${record.id}/messages`, { data: { text: "What did you suggest before about the sapphire lantern?", itemId: randomUUID() } });
    expect(recalled.ok()).toBeTruthy();
    expect((await recalled.json()).session.messages.at(-1).sources[0].messageId).toBe(question.id);
    await page.goto(base);
    const source = page.getByTestId("recall-source");
    await expect(source).toBeVisible();
    await source.hover();
    await source.focus();
    await page.keyboard.press("Enter");
    const original = page.locator(`[data-message-id="${question.id}"]`);
    await expect(original).toBeInViewport();
    await expect(original).toHaveAttribute("data-highlighted", "true");
    await expect(page.getByText(answer.text, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`recall-${width}-${language}.png`) });
    await expect(original).not.toHaveAttribute("data-highlighted", "true");
    await page.getByTestId("recall-latest").click();
    await expect(source).toBeVisible();
    await page.getByTestId("recall-calendar").click();
    await expect(page.getByTestId("recall-date-go")).toBeDisabled();
    await page.getByTestId("recall-date").fill("2025-03-12");
    await page.getByTestId("recall-date-go").click();
    await expect(original).toBeInViewport();
    await expect(original).toHaveAttribute("data-highlighted", "true");
    await page.getByTestId("recall-calendar").click();
    await page.getByTestId("recall-date").fill("2025-01-01");
    await page.getByTestId("recall-date-go").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByTestId("recall-latest").click();
    await expect(page.getByTestId("conversation-input")).toBeVisible();
  });
});
