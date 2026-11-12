import { expect, test } from "@playwright/test";

for (const language of ["zh", "en", "es"] as const) test(`a pending inviter can join with their partner's code (${language})`, async ({ browser, baseURL }, testInfo) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  const b = await browser.newContext({ baseURL });
  const labels = {
    zh: { join: "接受邀请", back: "先使用我的私人空间", us: "我们俩" },
    en: { join: "Accept invite", back: "Use my private space first", us: "Us" },
    es: { join: "Aceptar invitación", back: "Usar primero mi espacio privado", us: "Nosotros" },
  }[language];
  try {
    for (const [index, context] of [a, b].entries()) {
      await context.addInitScript((lang) => { localStorage.setItem("toward-us:onboarded", "1"); localStorage.setItem("toward-us.language", lang); }, language);
      expect((await context.request.post("/api/auth/register", { data: { aiConsent: true, name: index ? "Sam" : "Alex", email: `pair-${language}-${index}-${Date.now()}@example.invalid`, password: "synthetic-local-password" } })).status()).toBe(201);
    }
    const own = await (await a.request.post("/api/partner/invitations")).json();
    const partner = await (await b.request.post("/api/partner/invitations")).json();
    const page = await a.newPage(); await page.goto("/?channel=us");
    const invitation = page.getByTestId("conversation-invite");
    await expect(invitation.getByRole("button")).toHaveCount(2);
    await page.getByTestId("enter-partner-code").click();
    const screen = page.locator(".pairing-screen"), input = screen.getByTestId("invite-code");
    const join = screen.getByRole("button", { name: labels.join, exact: true });
    await expect(screen.locator("main").getByRole("button")).toHaveCount(2);
    await expect(join).toBeDisabled();
    await input.fill(own.pairing.invitation.code); await expect(join).toBeDisabled();
    await input.fill("AAAAAAA"); await expect(join).toBeDisabled();
    await input.fill("ZZZZZZZZ"); await join.click();
    await expect(screen.getByRole("alert")).toBeVisible(); await expect(input).toHaveValue("ZZZZZZZZ");
    expect((await (await a.request.get("/api/auth/me")).json()).pairing.status).toBe("pending");
    await input.fill(partner.pairing.invitation.code.toLowerCase());
    await expect(input).toHaveValue(partner.pairing.invitation.code);
    await expect(screen.getByRole("alert")).toHaveCount(0);
    await page.getByRole("heading").click();
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await join.hover(); await page.keyboard.press("Tab"); await join.focus();
      await page.screenshot({ path: testInfo.outputPath(`pairing-${language}-${width}.png`), fullPage: true });
      await expect(join).toBeFocused();
      expect(await join.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
      expect(await screen.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    // Cancel preserves the pending invite; reopening reaches the same existing form.
    await screen.getByRole("button", { name: labels.back, exact: true }).click();
    const usTab = () => page.getByRole("tab", { name: labels.us, exact: true });
    await usTab().click(); await page.getByTestId("enter-partner-code").click();
    await input.fill(partner.pairing.invitation.code); await join.click();
    await expect(page.getByTestId("conversation-screen")).toBeVisible();
    await expect(usTab()).toHaveAttribute("aria-selected", "true");
    const ownerState = await (await a.request.get("/api/auth/me")).json(), partnerState = await (await b.request.get("/api/auth/me")).json();
    expect(ownerState.pairing.status).toBe("active"); expect(ownerState.pairing.id).toBe(partnerState.pairing.id);
    expect(ownerState.pairing.members).toHaveLength(2);
  } finally { await a.close(); await b.close(); }
});
