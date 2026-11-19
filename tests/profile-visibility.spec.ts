import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import type { Server } from "node:http";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

let server: Server, directory: string, store: Awaited<ReturnType<typeof createFileStore>>, base: string;
let vite: ViteDevServer;
test.beforeAll(async () => {
  const root = resolve("work"); await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "profile-visibility-"));
  store = await createFileStore(join(directory, "state.json"));
  const app = createApiApp({ store, mediator: {
    aiReady: false, model: "local-test",
    // A check-in invokes the shared Agent after saving the member's answer. Keep only model output local;
    // the browser, authenticated API, visibility projection and persistence remain real.
    continueTogether: async (_context: unknown, language: "zh" | "en" | "es") => ({
      reply: { zh: "已记下你的回答。", en: "Your answer is recorded.", es: "Tu respuesta está guardada." }[language],
      draftAgreement: null, actions: [],
    }),
  } });
  // CI runs relationship checks before build; serve current source, never a stale dist bundle.
  vite = await createServer({ root: resolve("."), appType: "spa", server: { middlewareMode: true, hmr: false } });
  app.use(vite.middlewares);
  const port = Number(process.env.PINKY_PROFILE_TEST_PORT || 5383);
  if (port < 5300 || port > 5399) throw new Error("Use a local test port between 5300 and 5399.");
  server = app.listen(port, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  base = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await vite?.close();
  if (directory && directory.startsWith(resolve("work") + sep)) await rm(directory, { recursive: true, force: true });
});

for (const language of ["zh", "en", "es"] as const) test(`profile shows who sees each copy and withdraws only the share (${language})`, async ({ browser }, testInfo) => {
  const a = await browser.newContext({ baseURL: base, viewport: { width: 375, height: 812 } });
  const b = await browser.newContext({ baseURL: base });
  const labels = {
    zh: { private: "只有我", shared: "我们俩", edit: "修改或删除", change: "改成", save: "保存", share: "预览分享", withdraw: "收回分享，保留私人记录" },
    en: { private: "Just me", shared: "Us", edit: "Edit or remove", change: "Change to", save: "Save", share: "Preview share", withdraw: "Withdraw share, keep private note" },
    es: { private: "Solo yo", shared: "Nosotros", edit: "Editar o borrar", change: "Cambiar a", save: "Guardar", share: "Vista previa", withdraw: "Retirar copia, conservar nota privada" },
  }[language];
  const original = { zh: "周末喜欢慢慢吃早餐", en: "Enjoys slow weekend breakfasts", es: "Le gusta desayunar sin prisa" }[language];
  const revised = { zh: "周末喜欢一起散步", en: "Enjoys weekend walks together", es: "Le gusta pasear juntos el fin de semana" }[language];
  try {
    for (const context of [a, b]) await context.addInitScript((lang) => {
      localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", lang);
    }, language);
    const register = async (context: typeof a, name: string) => {
      const response = await context.request.post("/api/auth/register", { data: { aiConsent: true, name, email: `${name}-${language}-${Date.now()}@example.invalid`, password: "local-test-password" } });
      expect(response.status()).toBe(201); return (await response.json()).user;
    };
    const owner = await register(a, "Alex"), partner = await register(b, "Sam");
    const invitation = await (await a.request.post("/api/partner/invitations")).json();
    expect((await b.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    const relationshipId = invitation.pairing.id;
    const note = createRelationshipRecord({ relationshipId, userId: owner.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: owner.id, category: "likes", text: original });
    const aboutUs = createRelationshipRecord({ relationshipId, userId: owner.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: null, category: "traits", text: revised });
    const together = createRelationshipRecord({ relationshipId, userId: owner.id, visibility: "shared", aiAccessScope: "joint", status: "active", kind: "profile", subjectUserId: null, category: "traits", text: original, memberUserIds: [owner.id, partner.id], evidence: { channel: "together" } });
    for (const fact of [note, aboutUs, together]) await store.createRelationshipRecord("memories", fact);
    const page = await a.newPage(); await page.goto("/");
    await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-profile").click();
    await page.getByTestId("profile-tab-me").click();
    await expect(page.locator(".profile-ask")).toHaveCount(0);
    const rows = page.getByTestId("profile-fact");
    await expect(rows).toHaveCount(1); await expect(rows.first().getByTestId("profile-visibility")).toHaveText(labels.private);
    await rows.first().click();
    const sheet = page.locator(".profile-sheet");
    await expect(sheet.getByRole("button")).toHaveCount(2);
    await sheet.getByTestId("profile-share").click();
    await expect(sheet.locator("blockquote")).toHaveText(original);
    expect(JSON.stringify(await (await b.request.get("/api/profile")).json())).not.toContain(note.id);
    await sheet.getByTestId("profile-share-confirm").click();
    await expect(rows).toHaveCount(2);
    await expect(rows.getByTestId("profile-visibility")).toHaveText([labels.private, labels.shared]);
    const privateRow = rows.filter({ has: page.getByTestId("profile-visibility").filter({ hasText: labels.private }) });
    const sharedRow = rows.filter({ has: page.getByTestId("profile-visibility").filter({ hasText: new RegExp(`^${labels.shared}$`) }) });
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await privateRow.hover(); await page.keyboard.press("Tab"); await privateRow.focus();
      expect(await privateRow.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
      expect(await privateRow.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
      await page.screenshot({ path: testInfo.outputPath(`profile-${language}-${width}.png`) });
      expect(await rows.evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth))).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await privateRow.click(); await sheet.getByRole("button", { name: labels.edit, exact: true }).click();
    await sheet.getByRole("textbox", { name: labels.change, exact: true }).fill("");
    await expect(sheet.getByRole("button", { name: labels.save, exact: true })).toBeDisabled();
    await expect(sheet.getByRole("button")).toHaveCount(2);
    await sheet.getByRole("textbox").fill(revised);
    await sheet.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(privateRow).toContainText(revised); await expect(sharedRow).toContainText(original);
    await sharedRow.click(); await expect(sheet.getByTestId("profile-visibility")).toHaveText(labels.shared);
    await sheet.getByRole("button", { name: labels.withdraw, exact: true }).click();
    await expect(rows).toHaveCount(1); await expect(privateRow).toContainText(revised);
    const partnerFacts = (await (await b.request.get("/api/profile")).json()).facts;
    expect(partnerFacts.some((fact: { text: string; subject: string }) => fact.subject !== "us")).toBe(false);
    await page.getByTestId("profile-tab-us").click();
    await expect(rows).toHaveCount(2);
    // The seeded records can share a millisecond timestamp; their order is not a visibility guarantee.
    await expect(rows.getByTestId("profile-visibility").filter({ hasText: new RegExp(`^${labels.private}$`) })).toHaveCount(1);
    await expect(rows.getByTestId("profile-visibility").filter({ hasText: new RegExp(`^${labels.shared}$`) })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`profile-us-${language}-375.png`) });
    // The adjacent first-use review cards retain all answers with one send action.
    const session = (await (await a.request.get("/api/assistant/sessions/latest")).json()).session;
    await store.updateRelationshipRecordForUser("privateAgentThreads", session.id, owner.id, (draft) => {
      draft.messages = [{ id: `date-${language}`, role: "assistant", text: original, createdAt: new Date().toISOString(), dateCheck: { title: "Local test date", date: "2026-11-07" } }];
    });
    await page.goto("/");
    const dateReply = page.getByTestId("date-check-answers");
    await expect(dateReply.getByRole("button")).toHaveCount(1);
    await expect(dateReply.getByRole("button")).toBeDisabled();
    await expect(dateReply.locator("option")).toHaveCount(4);
    await dateReply.getByRole("combobox").selectOption("meh");
    await dateReply.getByRole("button").click(); await expect(dateReply).toHaveCount(0);
    expect((await store.getRelationshipRecordForUser("privateAgentThreads", session.id, owner.id)).messages[0].dateAnswer.rating).toBe("meh");
    await a.request.get("/api/together");
    await store.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, owner.id, (draft) => {
      draft.messages.push({ id: `review-${language}`, role: "agent", kind: "review", text: original, createdAt: new Date().toISOString(), refs: [{ type: "agreement", id: "local-review", version: 1 }] });
    });
    await page.goto("/?channel=us");
    const review = page.getByTestId("check-in-answers");
    await expect(review.getByRole("button")).toHaveCount(1); await expect(review.getByRole("button")).toBeDisabled();
    await expect(review.locator("option")).toHaveCount(4);
    const reply = { zh: "做到了一部分", en: "Partly", es: "En parte" }[language];
    await review.getByRole("combobox").selectOption(reply);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await expect(review.getByRole("button")).toBeEnabled();
      expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`review-${language}-${width}.png`) });
    }
    const sent = page.waitForResponse((response) => response.url() === `${base}/api/together/messages` && response.request().method() === "POST");
    await review.getByRole("button").click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const result = await response.json();
    expect(result.message).toMatchObject({ actorUserId: owner.id, text: reply, replyTo: `review-${language}` });
    expect(result.reply).toMatchObject({ role: "agent", replyTo: result.message.id });
    await expect(review).toHaveCount(0);
    expect((await (await a.request.get("/api/together")).json()).conversation.messages.some((message: { actorUserId: string; text: string }) => message.actorUserId === owner.id && message.text === reply)).toBe(true);
  } finally { await a.close(); await b.close(); }
});
