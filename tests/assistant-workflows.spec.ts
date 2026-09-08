import { expect, test } from "@playwright/test";

// Transport fixtures exercise the UI and microphone lifecycle. Semantic execution
// and persistence are covered separately through the real application API.
test("private assistant keeps navigation and supports queued speech, interruption and text retry", async ({ page, context }) => {
  await context.request.post("/api/auth/register", { data: { name: "Voice tester", email: `voice-ui-${Date.now()}@example.invalid`, password: "synthetic-password-2026" } });
  const messages: Array<Record<string, unknown>> = [];
  const received: string[] = [];
  let failOnce = true;
  const session = () => ({ id: "ui-session", language: "zh", timezone: "UTC", version: messages.length + 1, messages });
  await page.addInitScript(() => {
    const state = { events: null as null | ((event: { data: string }) => void), stopped: 0, cancelled: 0 };
    Object.assign(window, { voiceTest: state });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => state.stopped++ }], getAudioTracks: () => [{}] }) } });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel: () => state.cancelled++, speak: () => {}, getVoices: () => [] } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { lang = ""; text: string; constructor(text: string) { this.text = text; } } });
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: class {
      channel: Record<string, unknown> = { close: () => {}, readyState: "open" };
      createDataChannel() { return this.channel; }
      addTrack() {} async createOffer() { return { sdp: "v=0" }; }
      async setLocalDescription() {} async setRemoteDescription() { state.events = this.channel.onmessage as typeof state.events; (this.channel.onopen as () => void)(); }
      close() {}
    } });
  });
  await page.route("**/api/assistant/sessions**", async route => {
    const request = route.request();
    if (request.url().endsWith("/realtime")) return route.fulfill({ body: "v=0", contentType: "application/sdp" });
    if (/\/(messages|transcripts)$/.test(request.url())) {
      const body = request.postDataJSON(); received.push(body.itemId);
      if (body.text === "重试这句话" && failOnce) { failOnce = false; return route.abort(); }
      if (!messages.some(message => message.itemId === body.itemId)) {
        messages.push({ id: body.itemId, role: "user", text: body.text, itemId: body.itemId, createdAt: new Date().toISOString() });
        messages.push({ id: `${body.itemId}-reply`, role: "assistant", text: "已保存私人提醒。", createdAt: new Date().toISOString(), cards: [{ id: "reminder-one", kind: "reminder", title: "周末散步", status: "active", version: 1, localDateTime: "2030-01-11T20:00", timezone: "UTC", frequency: "weekly" }] });
      }
    }
    return route.fulfill({ json: { session: session() } });
  });
  await page.goto("/");
  await page.getByTestId("assistant-open").click();
  await page.getByTestId("assistant-microphone").click();
  await expect(page.getByTestId("assistant-microphone")).toContainText("结束语音");
  await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { events: (event: { data: string }) => void } }).voiceTest;
    for (const [item_id, transcript] of [["speech-one", "周五提醒我散步"], ["speech-two", "改到九点"]]) {
      state.events({ data: JSON.stringify({ type: "input_audio_buffer.speech_started", item_id }) });
      state.events({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript }) });
    }
  });
  await expect(page.locator(".assistant-message-user")).toHaveCount(2);
  expect(received).toEqual(["speech-one", "speech-two"]);
  await expect(page.locator(".assistant-result-card").last()).toContainText("周末散步");
  await page.getByTestId("assistant-microphone").click();
  await page.getByTestId("assistant-input").fill("重试这句话");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-retry")).toBeVisible();
  await page.getByTestId("assistant-retry").click();
  await expect(page.locator(".assistant-message-user")).toHaveCount(3);
  expect(received.at(-1)).toBe(received.at(-2));
  await page.getByTestId("assistant-collapse").click();
  await expect(page.getByRole("button", { name: "记忆与日常", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { stopped: number } }).voiceTest.stopped)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("assistant-open").click();
  await expect(page.getByTestId("assistant-panel")).toContainText("privado");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shared home keeps the assistant clear of the hero on desktop and mobile", async ({ page, context, browser }, testInfo) => {
  const suffix = Date.now();
  await context.request.post("/api/auth/register", { data: { name: "Alex", email: `voice-layout-a-${suffix}@example.invalid`, password: "synthetic-password-2026" } });
  const partner = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await partner.request.post("/api/auth/register", { data: { name: "Sam", email: `voice-layout-b-${suffix}@example.invalid`, password: "synthetic-password-2026" } });
    const invitation = await (await context.request.post("/api/partner/invitations", { data: {} })).json();
    expect((await partner.request.post("/api/partner/accept", { data: { code: invitation.pairing.invitation.code } })).ok()).toBe(true);
    await page.goto("/");
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("assistant-open")).toBeVisible();
      for (const expanded of [false, true]) {
        if (expanded) await page.getByTestId("assistant-open").click();
        const panel = await page.getByTestId("assistant-panel").boundingBox();
        const hero = await page.locator(".relationship-hero").boundingBox();
        expect(panel).not.toBeNull(); expect(hero).not.toBeNull();
        expect(hero!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height);
        if (expanded) await page.getByTestId("assistant-collapse").click();
      }
      await expect(page.getByRole("navigation", { name: "共同空间导航" }).getByRole("button")).toHaveCount(5);
    }
  } finally { await partner.close(); }
});
