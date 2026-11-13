// App Store screenshots from the real app with fictional people only (founder 11-12 App Store prep).
//
//   node tools/app-store/screenshots.mjs [--languages=en,zh,es] [--sizes=6.3,6.9]
//
// Starts a throwaway local server (its own temporary data file, never the dogfood data) with AI_PROVIDER=claude-cli, so
// Pinky's replies are real product output written through the local Claude subscription; no paid API is called.
// Two fictional members sign up, agree to third-party AI, pair, talk, and each screen is captured at the iPhone sizes
// App Store Connect accepts: 6.3" 1206x2622 (the required "Dynamic Island, medium" group) and 6.9" 1320x2868.
// Output: docs/app-store/screenshots/<language>/<size>/NN-name.png. Re-run after a visible UI change.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => (process.argv.find((item) => item.startsWith(`--${name}=`)) || "").split("=")[1] || fallback;
const LANGUAGES = arg("languages", "en,zh,es").split(",");
const SIZES = { "6.3": { width: 402, height: 874 }, "6.9": { width: 440, height: 956 } }; // CSS points, rendered at 3x
const sizes = arg("sizes", "6.3,6.9").split(",").filter((size) => SIZES[size]);
const PORT = Number(arg("port", "5197"));
const base = `http://127.0.0.1:${PORT}`;

const PEOPLE = {
  en: { a: "Mia", b: "Leo",
    private: "Leo forgot our anniversary dinner again. I'm hurt, but I don't want tonight to turn into a fight. How do I bring it up?",
    partner: "Sorry about last night. Can we sort out the chores thing calmly? 🙂",
    plan: "@Pinky we keep arguing about the dishes. Can you help us agree on a fair way to split chores this week?",
    remind: "Remind me Friday at 6pm to book the table for Saturday." },
  zh: { a: "小雨", b: "阿杰",
    private: "阿杰又忘了我们的纪念日晚饭，我有点难过，但不想今晚吵起来。我该怎么跟他说？",
    partner: "昨晚是我语气不好。家务的事我们好好商量一下吧 🙂",
    plan: "@Pinky 我们老为洗碗吵架，帮我们商量一个这周公平分家务的办法吧。",
    remind: "提醒我周五晚上 6 点订周六的位子。" },
  es: { a: "Lucía", b: "Mateo",
    private: "Mateo volvió a olvidar nuestra cena de aniversario. Me dolió, pero no quiero que esta noche termine en pelea. ¿Cómo se lo digo?",
    partner: "Perdón por lo de anoche. ¿Hablamos con calma de las tareas? 🙂",
    plan: "@Pinky siempre discutimos por los platos. ¿Nos ayudas a acordar un reparto justo de las tareas esta semana?",
    remind: "Recuérdame el viernes a las 6 de la tarde reservar la mesa del sábado." },
};

async function startServer(dataFile) {
  const env = { ...process.env, PORT: String(PORT), TOWARD_US_DATA_FILE: dataFile, AI_PROVIDER: "claude-cli", NODE_ENV: "development" };
  for (const key of Object.keys(env)) if (/^(OPENAI|ANTHROPIC|STRIPE|SENDBLUE|FCM|RESEND|DATABASE_URL|FOUNDER_EMAILS)/.test(key)) delete env[key];
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {}); child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill(); throw new Error("server did not start");
}

async function member(browser, language, name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: { zh: "zh-CN", en: "en-US", es: "es-ES" }[language], baseURL: base });
  await context.addInitScript((value) => { try { localStorage.setItem("toward-us.language", value); localStorage.setItem("toward-us:onboarded", "1"); } catch { /* private */ } }, language);
  const email = `${{ "小雨": "xiaoyu", "阿杰": "ajie" }[name] || name.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}.${language}@example.com`;
  const response = await context.request.post("/api/auth/register", { data: { aiConsent: true, name, email, password: "fictional-demo-password-2026" } });
  if (response.status() !== 201) throw new Error(`register ${name}: ${response.status()} ${await response.text()}`);
  return context;
}

/** Closes the first-run tour and the "Try this" cards, and folds the opening suggestions away (they fold once you start
 * typing), the way a person would, so each screenshot shows the conversation itself. */
async function clear(page) {
  for (let round = 0; round < 8; round += 1) {
    const skip = page.locator(".onboarding-skip, .discovery-later").first();
    if (!(await skip.isVisible().catch(() => false))) break;
    await skip.click(); await page.waitForTimeout(300);
  }
  // Today's question can come in the wrong language (a known bug, docs/app-store/audit.zh-CN.md): set it aside as a person
  // would rather than show it.
  const defer = page.getByTestId("daily-defer");
  if (await defer.isVisible().catch(() => false)) { await defer.click(); await page.waitForTimeout(500); }
  const input = page.getByTestId("conversation-input");
  if (await page.getByTestId("composer-ideas").isVisible().catch(() => false) && await input.isVisible().catch(() => false)) {
    await input.fill("."); await input.fill(""); await page.waitForTimeout(300);
  }
}
const UNAVAILABLE = /Pinky is unavailable right now|Pinky 暂时不可用|Pinky no está disponible/;
/** Says something to Pinky in Us and waits for its answer; when the local model timed out, asks once more. */
async function askPinky(page, text) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = (await page.locator("body").innerText()).match(new RegExp(UNAVAILABLE, "g"))?.length || 0;
    await say(page, text, "us"); await settle(page, 25_000);
    for (let wait = 0; wait < 12; wait += 1) {
      const body = await page.locator("body").innerText();
      if ((body.match(new RegExp(UNAVAILABLE, "g"))?.length || 0) > before) break;
      await page.waitForTimeout(5000);
    }
    if (((await page.locator("body").innerText()).match(new RegExp(UNAVAILABLE, "g"))?.length || 0) <= before) return;
    console.log("Pinky timed out in Us; asking again");
  }
}
async function openSettings(page) {
  await page.goto("/"); await page.getByTestId("conversation-input").waitFor(); await clear(page);
  await page.getByRole("button", { name: /^(打开菜单|Open menu|Abrir menú)$/ }).click();
  await page.getByRole("button", { name: /^(设置|Settings|Ajustes)$/ }).click();
  await page.getByTestId("settings-screen").waitFor();
}

async function say(page, text, channel) {
  await page.goto(`/?channel=${channel}`); await page.getByTestId("conversation-input").waitFor(); await clear(page);
  const reply = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/(assistant\/sessions\/[^/]+\/messages|together\/messages)$/.test(new URL(response.url()).pathname), { timeout: 240_000 });
  await page.getByTestId("conversation-input").fill(text);
  await page.getByTestId("conversation-send").click();
  try { await reply; } catch (error) { await page.screenshot({ path: join(tmpdir(), "pinky-store-shot-failure.png") }).catch(() => {}); throw error; }
}

/** Waits until Pinky's answer in the Us chat has arrived (it comes over the live event stream after the POST). */
async function settle(page, ms = 4000) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); }

async function shoot(page, language, size, name) {
  await clear(page);
  const directory = join(root, "docs", "app-store", "screenshots", language, size);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(directory, `${name}.png`) });
  console.log(`${language} ${size} ${name}`);
}

const temp = await mkdtemp(join(tmpdir(), "pinky-store-shots-"));
const server = await startServer(join(temp, "state.json"));
const browser = await chromium.launch();
try {
  for (const language of LANGUAGES) {
    const people = PEOPLE[language];
    const viewport = SIZES[sizes[0]];
    const a = await member(browser, language, people.a, viewport), b = await member(browser, language, people.b, viewport);
    const invite = await (await a.request.post("/api/partner/invitations", { data: {} })).json();
    await b.request.post("/api/partner/accept", { data: { code: invite.pairing.invitation.code } });
    await a.request.put("/api/relationship/together-since", { data: { date: "2024-05-18" } }).catch(() => {});
    const pa = await a.newPage(), pb = await b.newPage();

    await say(pa, people.private, "me"); await settle(pa);
    const privateUrl = "/?channel=me";
    await say(pb, people.partner, "us"); await askPinky(pa, people.plan);
    const usUrl = "/?channel=us";
    await say(pa, people.remind, "me"); await settle(pa);

    for (const size of sizes) {
      await pa.setViewportSize(SIZES[size]);
      await pa.goto(privateUrl); await settle(pa, 2500);
      await pa.evaluate(() => { const scroller = [...document.querySelectorAll("*")].filter((node) => node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY !== "visible"); for (const node of scroller) node.scrollTop = 0; });
      await shoot(pa, language, size, "01-just-me");
      await pa.goto(usUrl); await settle(pa, 2500); await shoot(pa, language, size, "02-us-plan");
      await pa.goto(privateUrl); await settle(pa, 2500); await shoot(pa, language, size, "03-reminder");
      await openSettings(pa); await pa.getByTestId("settings-access").click(); await settle(pa, 2000); await shoot(pa, language, size, "04-what-pinky-sees");
      await openSettings(pa); await pa.getByTestId("settings-access").scrollIntoViewIfNeeded(); await shoot(pa, language, size, "05-privacy-controls");
    }
    await a.close(); await b.close();
  }
} finally {
  await browser.close(); server.kill(); await rm(temp, { recursive: true, force: true });
}
