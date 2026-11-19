// App Store screenshots from the real app with fictional people only (founder 11-12 App Store prep).
//
//   node tools/app-store/screenshots.mjs [--languages=en,zh,es] [--sizes=6.3,6.9]
//
// Starts a throwaway local server (its own temporary data file, without provider keys or the dogfood environment).
// These screens use real non-generative features; no AI conversations or results are staged.
// Two fictional members sign up, agree to third-party AI, pair, set their anniversary, and each screen is captured at the iPhone sizes
// App Store Connect accepts: 6.3" 1206x2622 and 6.9" 1320x2868.
// Output: docs/app-store/screenshots/<language>/<size>/NN-name.png. Re-run after a visible UI change.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { AI_NOTICE_VERSION } from "../../server/ai-permission.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  en: { a: "Mia", b: "Leo" },
  zh: { a: "小雨", b: "阿杰" },
  es: { a: "Lucía", b: "Mateo" },
};

async function startServer(dataFile) {
  const env = { PORT: String(PORT), TOWARD_US_DATA_FILE: dataFile, NODE_ENV: "development",
    TOWARD_US_ENV_FILE: join(dirname(dataFile), "no-provider-secrets.env") };
  for (const key of ["PATH", "SystemRoot", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "LOCALAPPDATA"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  try {
    const existing = await fetch(`${base}/api/health`);
    if (existing) throw new Error(`Capture port ${PORT} already has a service`);
  } catch (error) {
    if (!error?.cause || error.cause.code !== "ECONNREFUSED") throw error;
  }
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {}); child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error("The capture server exited");
    try { if ((await fetch(`${base}/api/health`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill(); throw new Error("server did not start");
}

async function device(browser, language, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: { zh: "zh-CN", en: "en-US", es: "es-ES" }[language], baseURL: base });
  await context.addInitScript((value) => { localStorage.setItem("toward-us.language", value); }, language);
  return context;
}

async function post(context, url, data) {
  const response = await context.request.post(url, { data });
  if (!response.ok()) throw new Error(`${url} returned ${response.status()}`);
  return response.json();
}

async function member(browser, language, name, viewport, alias) {
  const context = await device(browser, language, viewport);
  await post(context, "/api/auth/register", { adultConfirmed: true, name, email: `${alias}.${language}@example.com`, password: "fictional-demo-password-2026" });
  await post(context, "/api/me/language", { language });
  await post(context, "/api/privacy/ai-consent", { agree: true, noticeVersion: AI_NOTICE_VERSION, language });
  return context;
}

async function openSettings(page) {
  await page.goto("/");
  await page.getByTestId("open-drawer").click();
  await page.getByRole("button", { name: /^(设置|Settings|Ajustes)$/ }).click();
  await page.getByTestId("settings-screen").waitFor();
}

async function shoot(page, language, size, name) {
  const directory = join(root, "docs", "app-store", "screenshots", language, size);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, `${name}.png`), animations: "disabled" });
  console.log(`${language} ${size} ${name}`);
}

const temp = await mkdtemp(join(tmpdir(), "ourever-store-shots-"));
const server = await startServer(join(temp, "state.json"));
let browser;
try {
  browser = await chromium.launch();
  for (const language of LANGUAGES) {
    const people = PEOPLE[language], viewport = SIZES[sizes[0]];
    const guest = await device(browser, language, viewport);
    const a = await member(browser, language, people.a, viewport, "first");
    const b = await member(browser, language, people.b, viewport, "second");
    const invite = await post(a, "/api/partner/invitations", {});
    await post(b, "/api/partner/accept", { code: invite.pairing.invitation.code });
    const since = await a.request.put("/api/relationship/together-since", { data: { date: "2024-05-18", language } });
    if (!since.ok()) throw new Error(`Unable to set the fictional anniversary: ${since.status()}`);
    const welcome = await guest.newPage(), page = await a.newPage();
    await page.goto("/");
    await page.locator(".onboarding-skip").click();
    await page.getByTestId("onboarding").waitFor({ state: "hidden" });
    for (const size of sizes) {
      await welcome.setViewportSize(SIZES[size]);
      await welcome.goto("/");
      await welcome.getByTestId("start-button").first().waitFor();
      await shoot(welcome, language, size, "01-welcome");
      await page.setViewportSize(SIZES[size]);
      await page.goto("/?view=capabilities");
      await page.getByTestId("capabilities-page").waitFor();
      await shoot(page, language, size, "02-what-you-can-do");
      await page.goto("/?view=upcoming");
      await page.getByTestId("upcoming-year").waitFor();
      await shoot(page, language, size, "03-calendar");
      await page.goto("/?game=hall");
      await page.getByTestId("game-card-deck").waitFor();
      await shoot(page, language, size, "04-play-together");
      await openSettings(page);
      await page.getByTestId("settings-access").click();
      await page.getByTestId("ai-access").waitFor();
      await shoot(page, language, size, "05-what-ourever-sees");
    }
    await guest.close(); await a.close(); await b.close();
  }
} finally {
  await browser?.close(); server.kill();
  await rm(temp, { recursive: true, force: true });
}
