import { expect, test } from "@playwright/test";

for (const language of ["zh", "en", "es"]) test(`daily questions are optional and keep private drafts through interruptions (${language})`, async ({ browser, baseURL }, testInfo) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  const b = await browser.newContext({ baseURL });
  try {
    for (const context of [a, b]) await context.addInitScript((lang) => {
      localStorage.setItem("toward-us:onboarded", "1");
      localStorage.setItem("toward-us.language", lang);
    }, language);
    const suffix = `${Date.now()}-${language}`;
    const register = async (context: typeof a, member: string) => {
      const response = await context.request.post("/api/auth/register", { data: { name: member, email: `draft-${suffix}-${member}@example.invalid`, password: "synthetic-local-password" } });
      expect(response.status()).toBe(201); return response.json();
    };
    const owner = await register(a, "Alex"); await register(b, "Sam");
    const invitation = await (await a.request.post("/api/partner/invitations")).json();
    expect((await b.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    // Today's question is generated asynchronously. Wait for the real stored question before testing its editor.
    await expect.poll(async () => {
      const state = await (await a.request.get(`/api/together?language=${language}`)).json();
      return state.conversation.messages.some((item: { kind: string }) => item.kind === "daily_question");
    }).toBe(true);
    const page = await a.newPage(); await page.goto("/?channel=us");
    const card = page.getByTestId("daily-question").last(), input = card.getByRole("textbox");
    const together = await (await a.request.get(`/api/together?language=${language}`)).json();
    const question = together.conversation.messages.filter((item: { kind: string }) => item.kind === "daily_question").at(-1);
    // Optional prompts must be dismissible without submitting an answer or changing the partner's view.
    const answerRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes(`/daily/${question.id}/answer`)) answerRequests.push(request.url()); });
    await expect(card.getByRole("button")).toHaveCount(2);
    await expect(input).toHaveCount(0);
    const defer = card.getByTestId("daily-defer");
    await defer.focus(); await expect(defer).toBeFocused(); await defer.hover();
    expect(await defer.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.screenshot({ path: testInfo.outputPath(`optional-${language}-${width}.png`), fullPage: true });
    }
    await defer.click();
    await expect(card.getByTestId("daily-resume")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(1);
    await expect(card.locator("strong")).toHaveCount(0);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await card.getByTestId("daily-resume").focus();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`deferred-${language}-${width}.png`), fullPage: true });
    }
    await page.reload(); await page.getByRole("tab").nth(1).click();
    await expect(card.getByTestId("daily-resume")).toBeVisible();
    const partnerPage = await b.newPage(); await partnerPage.goto("/?channel=us");
    await expect(partnerPage.getByTestId("daily-question").last().getByTestId("daily-defer")).toBeVisible();
    await expect(partnerPage.getByTestId("daily-resume")).toHaveCount(0);
    const unchanged = await (await a.request.get(`/api/together?language=${language}`)).json();
    expect(unchanged.conversation.messages.find((item: { id: string }) => item.id === question.id).answers).toEqual(question.answers);
    expect(answerRequests).toHaveLength(0);
    await partnerPage.close();
    await card.getByTestId("daily-resume").click();
    await expect(card.locator("strong")).toHaveText(question.translations?.[language]?.text || question.i18n?.[language] || question.text);
    await card.locator(".card-primary").click();
    await expect(input).toBeVisible();
    await expect(card.locator(".card-primary")).toBeDisabled();
    await page.setViewportSize({ width: 375, height: 812 });
    const key = `pinky:daily-draft:${owner.user.id}:${question.id}`;
    const text = { zh: "谢谢你昨天耐心听我说完。", en: "Thank you for listening patiently yesterday.", es: "Gracias por escucharme con paciencia ayer." }[language]!;
    await input.fill(text);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(text);
    const tabs = page.getByRole("tab");
    await tabs.nth(0).click(); await tabs.nth(1).click(); await expect(input).toHaveValue(text);
    await page.reload(); await tabs.nth(1).click(); await expect(input).toHaveValue(text);
    // A rejected local request must preserve the words, without suggesting they were submitted.
    await page.route("**/api/together/daily/*/answer", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "local_test_unavailable" }) }));
    await card.locator(".card-primary").click(); await expect(input).toBeEnabled(); await expect(input).toHaveValue(text);
    await page.unroute("**/api/together/daily/*/answer");
    expect(JSON.stringify(await (await b.request.get("/api/together")).json())).not.toContain(text);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await input.focus(); await page.getByRole("tab").nth(1).click();
      await expect(input).toHaveValue(text); await expect(card.getByRole("button")).toHaveCount(2);
      await expect(page.locator(".discovery-card").getByRole("button")).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`draft-${language}-${width}.png`), fullPage: true });
    }
    await card.locator(".card-primary").click(); await expect(input).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
    expect(JSON.stringify(await (await b.request.get("/api/together")).json())).not.toContain(text);
    // Edits have their own unsent draft; the submitted answer remains intact until explicitly replaced.
    await card.getByRole("button").click(); await input.fill(`${text} ❤️`);
    await page.reload(); await page.getByRole("tab").nth(1).click(); await expect(input).toHaveValue(`${text} ❤️`);
    await card.locator(".card-primary").click(); await expect(input).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
    expect((await b.request.post(`/api/together/daily/${question.id}/answer`, { data: { text: "Thank you too!", language } })).ok()).toBe(true);
    await expect(card.locator(".daily-answers")).toContainText(`${text} ❤️`);
  } finally { await a.close(); await b.close(); }
});

for (const language of ["zh", "en", "es"]) test(`new-user controls look tappable and tour cards have at most two buttons (${language})`, async ({ page }, testInfo) => {
  await page.addInitScript((lang) => localStorage.setItem("toward-us.language", lang), language);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?invite=ABCD1234");
  await page.getByTestId("start-button").click();
  const auth = page.locator(".auth-screen"); await expect(auth).toBeVisible();
  const switchButton = auth.locator(".auth-switch").first();
  expect(await switchButton.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await switchButton.focus(); await expect(switchButton).toBeFocused();
    await switchButton.hover();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`auth-${language}-${width}.png`), fullPage: true });
  }
  await page.getByTestId("register-name").fill("Taylor");
  await page.getByTestId("auth-email").fill(`new-user-${language}-${Date.now()}@example.invalid`);
  await page.getByTestId("auth-password").fill("synthetic-local-password");
  await page.getByTestId("auth-submit").click();
  const pairing = page.locator(".pairing-screen"); await expect(pairing).toBeVisible();
  await expect(pairing.locator(".text-action")).toHaveCount(0);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.screenshot({ path: testInfo.outputPath(`pairing-${language}-${width}.png`), fullPage: true });
  }
  await pairing.locator(".secondary-action").click();
  for (let step = 0; step < 4; step += 1) {
    await expect(page.getByTestId("onboarding")).toBeVisible();
    await expect(page.locator(".onboarding-card").getByRole("button")).toHaveCount(2);
    await page.getByTestId("onboarding-next").click();
  }
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
});
