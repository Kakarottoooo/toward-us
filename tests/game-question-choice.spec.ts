import { expect, test } from "@playwright/test";

for (const language of ["zh", "en", "es"] as const) test(`game questions can be declined without inventing an answer (${language})`, async ({ browser, baseURL }, testInfo) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  const b = await browser.newContext({ baseURL });
  try {
    const owners = [];
    for (const [index, context] of [a, b].entries()) {
      await context.addInitScript(lang => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", lang); }, language);
      const response = await context.request.post("/api/auth/register", { data: { aiConsent: true, name: index ? "Sam" : "Alex", email: `game-choice-${language}-${index}-${Date.now()}@example.invalid`, password: "synthetic-local-password" } });
      expect(response.status()).toBe(201); owners.push((await response.json()).user);
    }
    const invitation = await (await a.request.post("/api/partner/invitations")).json();
    expect((await b.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    const state = async (context = a) => (await (await context.request.get(`/api/together?language=${language}`)).json()).conversation.messages;
    const page = await a.newPage(), partner = await b.newPage();
    const submitted: string[] = [];
    page.on("request", request => { if (/\/games\/[^/]+\/answer$/.test(new URL(request.url()).pathname)) submitted.push(request.url()); });
    for (const type of ["choice", "guess", "truth"]) {
      expect((await a.request.post("/api/together/games", { data: { type, language } })).status()).toBe(201);
      const question = (await state()).filter((message: { kind: string }) => message.kind === "game").at(-1);
      const before = await state();
      await page.goto("/?channel=us"); await partner.goto("/?channel=us");
      const card = page.getByTestId("game-card").last(), partnerCard = partner.getByTestId("game-card").last();
      await expect(card.getByRole("button")).toHaveCount(2);
      const send = card.locator(".card-primary"); await expect(send).toBeDisabled();
      if (type !== "truth") {
        await card.getByRole("combobox").selectOption("0");
        await card.getByRole("combobox").selectOption("1");
        await expect(send).toBeEnabled();
        expect(submitted).toHaveLength(type === "choice" ? 0 : 2);
      } else await card.getByRole("textbox").fill("Private unsent game draft");
      const defer = card.getByTestId("game-defer");
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await defer.hover(); await defer.focus();
        expect(await defer.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
        expect(await defer.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe("solid");
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${type}-${language}-${width}.png`) });
      }
      const requestCount = submitted.length;
      await defer.click(); await expect(card.getByTestId("game-resume")).toBeVisible();
      await expect(card.getByRole("button")).toHaveCount(1); await expect(card.locator("strong")).toHaveCount(0);
      await expect(partnerCard.getByTestId("game-defer")).toBeVisible();
      await expect(partnerCard.getByTestId("game-resume")).toHaveCount(0);
      expect(submitted).toHaveLength(requestCount);
      expect((await state()).find((message: { id: string }) => message.id === question.id)).toEqual(before.find((message: { id: string }) => message.id === question.id));
      await card.getByTestId("game-resume").click();
      if (type === "truth") await expect(card.getByRole("textbox")).toHaveValue("Private unsent game draft");
      await card.getByTestId("game-defer").click();
      await page.reload(); await page.getByRole("tab").nth(1).click();
      await expect(card.getByTestId("game-resume")).toBeVisible();
      await card.getByTestId("game-resume").click();
      if (type === "truth") {
        const draftKey = `pinky:game-draft:${owners[0].id}:${question.id}`;
        await expect(card.getByRole("textbox")).toHaveValue("Private unsent game draft");
        await page.getByRole("tab").nth(0).click();
        await page.getByRole("tab").nth(1).click();
        await expect(card.getByRole("textbox")).toHaveValue("Private unsent game draft");
        await expect(partnerCard.getByRole("textbox")).toHaveValue("");
        expect((await state()).find((message: { id: string }) => message.id === question.id).answers).toEqual({});
        expect(await page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBe("Private unsent game draft");
        await card.getByRole("textbox").fill("");
        await expect(send).toBeDisabled();
        await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
        await card.getByRole("textbox").fill("Private unsent game draft");
        await page.route(`**/api/together/games/${question.id}/answer`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Local simulated retry" }) }), { times: 1 });
        await send.click();
        await expect(send).toBeEnabled();
        await expect(card.getByRole("textbox")).toHaveValue("Private unsent game draft");
        await page.reload(); await page.getByRole("tab").nth(1).click();
        await expect(card.getByRole("textbox")).toHaveValue("Private unsent game draft");
        for (const width of [375, 1280]) {
          await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
          await page.screenshot({ path: testInfo.outputPath(`restored-truth-${language}-${width}.png`) });
        }
        await send.click();
        await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
      } else {
        const answerPath = `**/api/together/games/${question.id}/answer`;
        await page.route(answerPath, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Local simulated retry" }) }), { times: 1 });
        await card.getByRole("combobox").selectOption("1"); await send.click();
        await expect(card.getByRole("combobox")).toHaveValue("1"); await expect(send).toBeEnabled();
        expect((await state()).find((message: { id: string }) => message.id === question.id).answers).toEqual({});
        await send.click();
      }
      await expect(card.locator(".game-wait")).toBeVisible();
      expect(Object.keys((await state(b)).find((message: { id: string }) => message.id === question.id).answers)).toHaveLength(0);
      const answer = type === "truth" ? { text: "Sam's local answer" } : { choice: 1 };
      expect((await b.request.post(`/api/together/games/${question.id}/answer`, { data: { ...answer, language } })).ok()).toBe(true);
      await expect(card.getByTestId("game-again")).toBeVisible();
      await expect(card.getByRole("button")).toHaveCount(1);
      const result = (await state()).find((message: { id: string }) => message.id === question.id);
      expect(result.answers[owners[0].id]).toMatchObject(type === "truth" ? { text: "Private unsent game draft" } : { choice: 1 });
      if (type !== "truth") expect(result.game.result.match).toBe(true);
    }
    expect((await a.request.post("/api/together/games", { data: { type: "truth", language } })).status()).toBe(201);
    await page.reload(); await page.getByRole("tab").nth(1).click();
    await expect(page.getByTestId("game-card").last().getByRole("textbox")).toHaveValue("");
  } finally { await a.close(); await b.close(); }
});
