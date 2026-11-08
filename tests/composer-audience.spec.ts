import { expect, test } from "@playwright/test";

for (const language of ["zh", "en", "es"] as const) test(`composer keeps its audience visible while writing (${language})`, async ({ browser, baseURL }, testInfo) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  const b = await browser.newContext({ baseURL });
  const words = {
    zh: { me: "只有我", us: "我们俩", private: "只有我 · 与 Pinky 私聊", shared: "我们俩 · Sam 也能看到", send: "发送到我们俩", ask: "叫 Pinky 来帮忙" },
    en: { me: "Just me", us: "Us", private: "Just me · Private with Pinky", shared: "Us · Sam can see this too", send: "Send to Us", ask: "Ask Pinky to help" },
    es: { me: "Solo yo", us: "Nosotros", private: "Solo yo · En privado con Pinky", shared: "Nosotros · Sam también lo verá", send: "Enviar a Nosotros", ask: "Pedir ayuda a Pinky" },
  }[language];
  try {
    test.setTimeout(45_000);
    for (const [index, context] of [a, b].entries()) {
      await context.addInitScript(lang => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", lang); }, language);
      expect((await context.request.post("/api/auth/register", { data: { name: index ? "Sam" : "Alex", email: `audience-${language}-${index}-${Date.now()}@example.invalid`, password: "synthetic-local-password" } })).status()).toBe(201);
    }
    const invitation = await (await a.request.post("/api/partner/invitations")).json();
    expect((await b.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    const page = await a.newPage(); await page.goto("/");
    const audience = page.getByTestId("composer-audience"), input = page.getByTestId("conversation-input"), send = page.getByTestId("conversation-send");
    await expect(audience).toHaveText(words.private);
    await expect(send).toBeDisabled();
    await input.fill("PRIVATE_UNSENT_THOUGHT");
    await expect(audience).toHaveText(words.private);
    await expect(input).toHaveAccessibleDescription(words.private);
    await page.getByRole("tab", { name: new RegExp(`^${words.us}`) }).click();
    await expect(input).toHaveValue(""); await expect(send).toBeDisabled();
    await expect(audience).toHaveText(words.shared);
    await input.fill("Shared local test greeting");
    const mention = page.getByRole("button", { name: words.ask, exact: true });
    await mention.click(); await expect(mention).toHaveAttribute("aria-pressed", "true");
    // Asking Pinky inside Us must never look like a private conversation.
    await expect(audience).toHaveText(words.shared);
    await expect(input).toHaveAccessibleDescription(words.shared);
    await expect(send).toHaveAccessibleName(words.send);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await audience.click(); await send.hover(); await page.keyboard.press("Tab"); await send.focus();
      await expect(send).toBeFocused();
      expect(await send.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
      expect(await mention.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe("solid");
      expect(await audience.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`audience-shared-${language}-${width}.png`), fullPage: true });
    }
    await mention.click();
    await send.click();
    await expect(input).toHaveValue("");
    const shared = await (await b.request.get("/api/together")).json();
    expect(JSON.stringify(shared)).toContain("Shared local test greeting");
    expect(JSON.stringify(shared)).not.toContain("PRIVATE_UNSENT_THOUGHT");
    await page.getByRole("tab", { name: new RegExp(`^${words.me}`) }).click();
    await expect(input).toHaveValue("PRIVATE_UNSENT_THOUGHT");
    await expect(audience).toHaveText(words.private);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.screenshot({ path: testInfo.outputPath(`audience-private-${language}-${width}.png`), fullPage: true });
    }
  } finally { await a.close(); await b.close(); }
});
