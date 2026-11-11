// Actual compiled conversation UI + real local API/store, no model subscription.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createHarness } from "./fixture.mjs";
import { createReadonlySite } from "./readonly-site.mjs";
import { createReadonlyWeb, pageUrls } from "../../server/readonly-web.mjs";

const output = resolve("output/playwright/task09");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "account-"));
const site = await createReadonlySite();
const mediator = { readonlyWeb: createReadonlyWeb({ testOrigin: site.origin }),
  planAssistantTurn: async (context) => !context.webPages ? ({ reply: "", actions: [{ kind: "web_read", operation: "query", targetId: null, expectedVersion: null, query: pageUrls(context.messages.at(-1).text)[0], queryPeriod: "all", occurrence: null, fields: {} }] }) : ({ reply: "青禾小馆的两人套餐280元，周六17:00–21:00营业。未预订。", actions: [] }),
  continueTogether: async (context) => !context.webPages ? ({ reply: "", actions: [{ kind: "web_read", operation: "create", text: pageUrls(context.messages.at(-1).text)[0] }] }) : ({ reply: "河岸摄影展11月14日14:00–18:00，两人120元。未购票。", actions: [] }),
};
const harness = await createHarness(directory, { mediator, clientRoot: resolve("dist/client") });
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  const setup = await harness.setup({ paired: { me: "UI小安", partner: "UI小闻" }, probe: { thread: "main" } });
  const session = await setup.open("main");
  await harness.call(`/assistant/sessions/${session}/messages`, { text: `只读 ${site.origin}/restaurant`, itemId: randomUUID(), language: "zh" }, setup.me.cookie);
  await harness.call("/together/messages", { text: `Pinky，只读 ${site.origin}/event`, itemId: randomUUID(), language: "zh" }, setup.me.cookie);
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const split = setup.me.cookie.indexOf("=");
    await context.addCookies([{ name: setup.me.cookie.slice(0, split), value: setup.me.cookie.slice(split + 1), url: harness.base }]);
    await context.addInitScript(({ userId, session }) => {
      localStorage.setItem("toward-us:onboarded", "1");
      localStorage.setItem(`toward-us:conversation-channel:${userId}`, "me");
      localStorage.setItem(`toward-us:conversation-session:${userId}`, session);
    }, { userId: setup.me.user.id, session });
    const page = await context.newPage();
    await page.goto(harness.base);
    for (const [channel, path] of [["me", "/restaurant"], ["us", "/event"]]) {
      if (channel === "us") await page.getByRole("tab", { name: /我们俩|Us|Nosotros/ }).click();
      const link = page.locator(`.conversation-message.from-agent a[href="${site.origin}${path}"]`).last();
      await link.waitFor({ state: "visible" });
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1);
      const popup = context.waitForEvent("page");
      await link.click();
      const opened = await popup;
      await opened.waitForLoadState("domcontentloaded");
      assert.equal(opened.url(), `${site.origin}${path}`);
      assert.match(await opened.locator("h1").innerText(), /虚构/);
      await opened.close();
      await page.screenshot({ path: join(output, `${width}-${channel}.png`), fullPage: true });
      evidence.push({ width, channel, linkOpened: true, url: `${site.origin}${path}`, box });
    }
    await context.close();
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ at: new Date().toISOString(), evidence, modelCalls: 0 }, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await harness.close(); await site.close(); }
