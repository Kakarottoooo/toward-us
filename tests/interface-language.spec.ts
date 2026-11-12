import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import type { Server } from "node:http";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

// AGENTS.md: in English or Spanish mode no Chinese interface text appears; only the English wordmark stays. App Store
// screenshots (11-12) still found Chinese reasons under the suggestions, a Chinese daily question for a Spanish couple and
// "1 items". This walks the main screens of a paired fictional couple in EN and ES and fails on any CJK character. All the
// couple's own words are in the screen's language, so any CJK on screen is the App's, not theirs. The model stand-in
// deliberately answers in Chinese, as a real model sometimes does: the server must keep that off English and Spanish screens.
const CJK = /[぀-ヿ㐀-鿿가-힯！-～]/;

let server: Server, directory: string, store: Awaited<ReturnType<typeof createFileStore>>, base: string;
let vite: ViteDevServer;
test.beforeAll(async () => {
  const root = resolve("work"); await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "interface-language-"));
  store = await createFileStore(join(directory, "state.json"));
  const app = createApiApp({ store, mediator: {
    aiReady: false, model: "local-test",
    continueTogether: async (_context: unknown, language: "zh" | "en" | "es") => ({
      reply: { zh: "好的，记下了。", en: "Got it, noted.", es: "Entendido, anotado." }[language], draftAgreement: null, actions: [],
    }),
    // The model writing in the wrong language: Chinese daily questions, reactions and suggestion reasons.
    structured: async ({ name, instructions }: { name: string; instructions: string }) => {
      const spanish = instructions.includes("Spanish");
      if (name === "composer_suggestions") return { suggestions: spanish
        ? [{ text: "Planea una cita", why: "你们刚聊到周六的饭局" }, { text: "Anota cómo me siento", why: "随便聊聊" }, { text: "Ideas de regalo", why: "生日快到了" }]
        : [{ text: "Plan a date", why: "你们刚聊到周六的饭局" }, { text: "Note how I feel", why: "随便聊聊" }, { text: "Gift ideas", why: "生日快到了" }] };
      if (name === "daily_question") return { question: "你们最近一次一起大笑是因为什么？" };
      if (name === "daily_reaction") return { reply: "你们俩都想去海边。" };
      throw Object.assign(new Error("not available in this test"), { statusCode: 503 });
    },
  } });
  // Serve current source, never a stale dist bundle.
  vite = await createServer({ root: resolve("."), appType: "spa", server: { middlewareMode: true, hmr: false } });
  app.use(vite.middlewares);
  const port = Number(process.env.PINKY_LANGUAGE_TEST_PORT || 5384);
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

/** Every visible piece of text on the page that contains CJK: text, placeholders, labels, titles, alt text, the tab title. */
async function leaks(page: Page) {
  return page.evaluate((source) => {
    const cjk = new RegExp(source);
    const found = new Set<string>();
    const visible = (element: Element) => { const box = (element as HTMLElement).getBoundingClientRect?.(); const style = getComputedStyle(element); return box && box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"; };
    const where = (element: Element | null) => { const parts: string[] = []; for (let at = element; at && parts.length < 3; at = at.parentElement) parts.unshift(at.getAttribute("data-testid") || at.className?.toString().split(" ")[0] || at.tagName.toLowerCase()); return parts.join(" > "); };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent || "", parent = node.parentElement;
      if (parent && cjk.test(text) && visible(parent) && !parent.closest("[lang^=zh]")) found.add(`${where(parent)}: ${text.trim().slice(0, 80)}`);
    }
    for (const element of document.querySelectorAll("[placeholder], [aria-label], [title], img[alt]")) {
      if (!visible(element) || element.closest("[lang^=zh]")) continue;
      for (const name of ["placeholder", "aria-label", "title", "alt"]) { const value = element.getAttribute(name) || ""; if (cjk.test(value)) found.add(`${where(element)} [${name}]: ${value.slice(0, 80)}`); }
    }
    if (cjk.test(document.title)) found.add(`document.title: ${document.title}`);
    return [...found];
  }, CJK.source);
}

for (const language of ["en", "es"] as const) test(`no Chinese on the main screens in ${language.toUpperCase()}`, async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const names = { en: ["Alex", "Sam"], es: ["Lucía", "Mateo"] }[language];
  const words = {
    en: { fact: "Loves slow weekend breakfasts", us: "Shall we cook together on Saturday?", reply: "Yes, pasta night!", date: "Our anniversary", private: "Remind me to book the table" },
    es: { fact: "Le encantan los desayunos tranquilos", us: "¿Cocinamos juntos el sábado?", reply: "¡Sí, noche de pasta!", date: "Nuestro aniversario", private: "Recuérdame reservar la mesa" },
  }[language];
  const a = await browser.newContext({ baseURL: base, viewport: { width: 393, height: 852 }, locale: language === "es" ? "es-ES" : "en-US" });
  const b = await browser.newContext({ baseURL: base, viewport: { width: 393, height: 852 }, locale: language === "es" ? "es-ES" : "en-US" });
  const found = new Map<string, string[]>();
  try {
    for (const context of [a, b]) await context.addInitScript((lang) => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", lang); }, language);
    const register = async (context: typeof a, name: string) => {
      const response = await context.request.post("/api/auth/register", { data: { aiConsent: true, name, email: `${name.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}-${language}-${Date.now()}@example.invalid`, password: "local-test-password" } });
      expect(response.status()).toBe(201); return (await response.json()).user;
    };
    const owner = await register(a, names[0]), partner = await register(b, names[1]);
    for (const context of [a, b]) expect((await context.request.post("/api/me/language", { data: { language } })).ok()).toBe(true);
    const invitation = await (await a.request.post("/api/partner/invitations")).json();
    expect((await b.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    const relationshipId = invitation.pairing.id;
    // A little of everything, all in the couple's own language.
    await store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId, userId: owner.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: owner.id, category: "likes", text: words.fact }));
    await store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: owner.id, visibility: "shared", aiAccessScope: "joint", type: "relationship_started", title: words.date, date: "2025-06-18", recurringRule: "yearly", memberUserIds: [owner.id, partner.id] }));
    const timezone = "?language=" + language + "&timezone=UTC";
    expect((await a.request.get(`/api/together${timezone}`)).ok()).toBe(true);
    expect((await a.request.post("/api/together/messages", { data: { text: words.us, language } })).ok()).toBe(true);
    expect((await b.request.post("/api/together/messages", { data: { text: words.reply, language } })).ok()).toBe(true);

    // Before signing in: the home screen (wordmark only, no Chinese subtitle), sign-in and sign-up.
    const visitor = await browser.newContext({ baseURL: base, viewport: { width: 393, height: 852 } });
    await visitor.addInitScript((lang) => localStorage.setItem("toward-us.language", lang), language);
    const door = await visitor.newPage(); await door.goto("/"); await door.waitForTimeout(700);
    const signedOut = [...await leaks(door)];
    await door.getByTestId("start-button").click(); await door.waitForTimeout(700); signedOut.push(...await leaks(door));
    await door.getByRole("button", { name: { en: "New here? Create an account", es: "¿Eres nuevo? Crea una cuenta" }[language] }).click(); await door.waitForTimeout(700); signedOut.push(...await leaks(door));
    if (signedOut.length) found.set("signed-out", signedOut);
    await visitor.close();

    const page = await a.newPage();
    const check = async (label: string) => {
      await page.waitForTimeout(700);
      const list = await leaks(page);
      if (list.length) found.set(label, list);
      await page.screenshot({ path: testInfo.outputPath(`${language}-${label.replace(/[^a-z0-9]+/gi, "-")}.png`) });
    };
    // Just me: the composer suggestions (fetched twice so the model's set with its reasons is the one shown).
    await page.goto("/"); await expect(page.getByTestId("composer-ideas")).toBeVisible(); await check("just-me");
    await page.reload(); await expect(page.getByTestId("composer-ideas")).toBeVisible(); await check("just-me-fresh-suggestions");
    // Us, with today's question.
    await page.goto("/?channel=us"); await expect(page.getByText(words.reply)).toBeVisible(); await check("us");
    // The menu and every page it opens.
    await page.goto("/"); await page.getByTestId("open-drawer").click(); await check("drawer");
    const drawer = await page.locator("[data-testid^=drawer-]").evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")!).filter((id) => !["drawer-share", "drawer-invite"].includes(id)));
    expect(drawer.length).toBeGreaterThan(4);
    for (const id of drawer) {
      await page.goto("/"); await page.getByTestId("open-drawer").click(); await page.getByTestId(id).click(); await check(id);
    }
    // Settings and its pages.
    for (const id of ["settings-access", "settings-profile", "settings-notifications", "settings-memory", "settings-processors", "settings-character", "settings-membership", "settings-report"]) {
      await page.goto("/"); await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-settings").click();
      const row = page.getByTestId(id);
      if (!(await row.count())) continue;
      await row.click(); await check(id);
    }
    // Pages reached by link.
    for (const view of ["capabilities", "people", "import", "membership", "space", "moments", "upcoming", "reminders", "plans", "decide"]) { await page.goto(`/?view=${view}`); await check(`view-${view}`); }
    // The partner sees the same Us.
    const other = await b.newPage(); await other.goto("/?channel=us"); await expect(other.getByText(words.us)).toBeVisible(); await other.waitForTimeout(700);
    const partnerLeaks = await leaks(other); if (partnerLeaks.length) found.set("us-partner", partnerLeaks);
    // The daily question the model wrote in Chinese was not posted; the fixed one is in the couple's language.
    const conversation = (await (await a.request.get(`/api/together${timezone}`)).json()).conversation;
    const question = conversation.messages.findLast((message: { kind: string }) => message.kind === "daily_question");
    expect.soft(question, "today's question was asked").toBeTruthy();
    expect.soft(CJK.test(question?.i18n?.[language] ?? question?.text ?? ""), "today's question is in the couple's language").toBe(false);
    // Settings → What Pinky can see counts in the singular: "1 item", "1 dato".
    await page.goto("/"); await page.getByTestId("open-drawer").click(); await page.getByTestId("drawer-settings").click(); await page.getByTestId("settings-access").click();
    await expect(page.getByTestId("ai-access")).toBeVisible();
    await expect.soft(page.locator(".settings-value").first()).toHaveText(language === "es" ? "1 dato" : "1 item");
  } finally { await a.close(); await b.close(); }
  expect([...found].map(([screen, list]) => `${screen}:\n  ${list.join("\n  ")}`).join("\n"), "Chinese text on an English or Spanish screen").toBe("");
});
