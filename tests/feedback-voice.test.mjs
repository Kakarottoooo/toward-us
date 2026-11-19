import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createMediator } from "../server/mediator.mjs";
import { flushAiLedger } from "../server/ai-ledger.mjs";
import { setAiConsent } from "../server/privacy-router.mjs";
import { withModeration } from "./helpers/moderation.mjs";
import { useTestMedia } from "./helpers/media.mjs";

function wave(seconds = 1) {
  const size = seconds * 32_000, bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF"); bytes.writeUInt32LE(36 + size, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(size, 40);
  return bytes;
}

test("feedback dictation admits only owner WAVs, meters the existing transcription, and retains no feedback or media", async (t) => {
  const work = join(process.cwd(), "work");
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(join(work, "voice-fixture-")), media = useTestMedia(t, directory);
  const store = await createFileStore(join(directory, "state.json"));
  const env = { AI_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", OPENAI_BASE_URL: "https://api.openai.com/v1" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let calls = 0, mode = "ok";
  const localFetch = globalThis.fetch;
  const transcript = "Fixture only. Hola. 你好。";
  t.mock.method(globalThis, "fetch", withModeration(async (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).href, "https://api.openai.com/v1/audio/transcriptions");
    calls++;
    const parts = await new Request(input, init).formData();
    assert.equal(parts.get("model"), "gpt-4o-transcribe-diarize");
    assert.equal(parts.get("language"), null, "the provider detects mixed-language speech");
    const file = parts.get("file");
    assert.equal(file.type, "audio/wav");
    const duration = (file.size - 44) / 32_000;
    if (mode === "fail") return Response.json({ error: { message: "private-provider-detail" } }, { status: 500 });
    return Response.json({ text: mode === "empty" ? "" : transcript, duration, segments: [], usage: { type: "duration", seconds: duration } });
  }));
  const server = createApiApp({ store, mediator: createMediator(), reminderService: { runDue: async () => ({}) } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await flushAiLedger();
    await rm(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const register = async () => {
    const response = await localFetch(base + "/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fixture", email: randomUUID() + "@example.invalid", password: randomUUID(), adultConfirmed: true }),
    });
    assert.equal(response.status, 201);
    return { id: (await response.json()).user.id, cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const owner = await register(), other = await register();
  const send = (member, { ownerRef = member.id, language = "es", bytes = wave(), type = "audio/wav" } = {}) => {
    const body = new FormData();
    body.set("owner_ref", ownerRef); body.set("language", language);
    body.set("audio", new Blob([bytes], { type }), "take.wav");
    return localFetch(base + "/api/feedback/voice", { method: "POST", headers: { cookie: member.cookie }, body });
  };
  assert.equal((await send({ ...owner, cookie: "" })).status, 401);
  assert.equal((await send(other, { ownerRef: owner.id })).status, 409);
  const noConsent = await send(owner);
  assert.equal(noConsent.status, 403);
  assert.deepEqual(await noConsent.json(), { error: "ai_consent_required" });
  await setAiConsent(store, owner.id, true); await setAiConsent(store, other.id, true);
  const malformed = wave(); malformed.writeUInt32LE(8_000, 24);
  for (const invalid of [{ language: "XX" }, { bytes: malformed }, { type: "audio/mpeg" }, { bytes: Buffer.from("not a recording") }]) {
    assert.equal((await send(owner, invalid)).status, 400);
  }
  assert.equal((await send(owner, { bytes: wave(121) })).status, 413);
  assert.equal(calls, 0);
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const first = await send(owner, { bytes: wave(120) });
  assert.equal(first.status, 200);
  assert.ok(first.headers.get("cache-control").includes("no-store"));
  assert.deepEqual(await first.json(), { text: transcript });
  await flushAiLedger();
  const ledger = (await store.listRecordsForJob("aiUsage")).filter((r) => r.kind === "ai_ledger");
  assert.equal(ledger.length, 1);
  const [row] = ledger;
  assert.deepEqual([row.feature, row.ownerUserId, row.provider, row.audioSeconds, row.estUsd], ["feedback_voice", owner.id, "openai", 120, 0.012]);
  assert.ok(!JSON.stringify(ledger).includes(transcript));
  mode = "fail";
  const failed = await send(owner);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "feedback_voice_unavailable" });
  assert.equal(calls, 2, "the SDK must not retry the failed upload");
  mode = "empty";
  assert.equal((await send(owner)).status, 422);
  mode = "ok";
  const burst = await Promise.all(Array.from({ length: 8 }, () => send(owner)));
  assert.deepEqual(burst.map((r) => r.status).sort(), [...Array(7).fill(200), 429]);
  assert.equal(calls, 10);
  assert.equal(burst.find((r) => r.status === 429).headers.get("retry-after"), "600");
  assert.equal((await send(other)).status, 200);
  t.mock.timers.setTime(now + 600_000);
  assert.equal((await send(owner)).status, 200);
  assert.equal((await store.listFeedbackForInbox({ since: "1970-01-01", limit: 10 })).length, 0);
  assert.deepEqual(await readdir(media, { recursive: true }).catch((e) => { if (e.code === "ENOENT") return []; throw e; }), []);
});
