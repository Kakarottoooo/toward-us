import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { useTestMedia } from "./helpers/media.mjs";

const feedback = "/api/feedback";
const internal = "/api/internal/feedback";
const pixel = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#0064c8" } });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ourever-feedback-"));
  const media = useTestMedia(t, directory);
  const store = await createFileStore(join(directory, "state.json"));
  const token = randomUUID();
  const previousToken = process.env.PINKY_METRICS_ADMIN_TOKEN;
  process.env.PINKY_METRICS_ADMIN_TOKEN = token;
  const pushes = [];
  const server = createApiApp({
    store, mediator: { aiReady: false, model: "fixture" },
    reminderService: { runDue: async () => ({}), notifyMember: async (userId, payload) => pushes.push({ userId, payload }) },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) delete process.env.PINKY_METRICS_ADMIN_TOKEN;
    else process.env.PINKY_METRICS_ADMIN_TOKEN = previousToken;
    await rm(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, { method, body, cookie, bearer, status = 200 } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (bearer) headers.authorization = "Bearer " + bearer;
    if (body && !(body instanceof FormData)) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(body);
    }
    const response = await fetch(base + path, { method: method || (body ? "POST" : "GET"), body, headers });
    const accepted = Array.isArray(status) ? status : [status];
    assert.ok(accepted.includes(response.status), (method || (body ? "POST" : "GET")) + " " + path + " returned " + response.status);
    return response;
  };
  const json = async (path, options) => (await request(path, options)).json();
  const register = async () => {
    const name = "Member" + randomUUID().slice(0, 8);
    const password = randomUUID();
    const email = name + "@example.invalid";
    const response = await request("/api/auth/register", { status: 201, body: { name, email, password, adultConfirmed: true } });
    const { user } = await response.json();
    return { id: user.id, cookie: response.headers.get("set-cookie").split(";")[0], email, name, password };
  };
  const post = (member, fields = {}, images = [], status = 201) => {
    const body = new FormData();
    body.append("payload", JSON.stringify({ owner_ref: member.id, client_id: randomUUID(), text: "Fixture symptom", kind: "bug", ...fields }));
    for (const image of images) body.append("images", image, "fixture." + image.type.split("/")[1]);
    return request(feedback, { cookie: member.cookie, body, status });
  };
  return { media, request, json, register, post, pushes, token };
}

test("feedback status updates are private, incremental, retryable and notify only the reporting account", async (t) => {
  const { json, request, register, post, pushes, token } = await fixture(t);
  const owner = await register(), other = await register();
  const admin = { bearer: token };
  const privateAction = "private-activity-fixture";
  const unknownField = "unrelated-field-fixture";
  const context = {
    view: "conversation-us", app_version: "1.2.3", build: "34", web_commit: "a".repeat(40),
    platform: "ios", device_model: "iPhone16,1", os_version: "18.2", locale: "en", timezone: "America/Los_Angeles",
    errors: [{ message: "TypeError", stack: "" }], failed_requests: [{ path: "/api/feedback", status: 503 }],
    unrelated: unknownField,
  };
  const fields = { client_id: randomUUID(), context, include_activity: false, activity: privateAction };
  const { id } = await (await post(owner, fields)).json();
  assert.ok(id);
  assert.equal((await (await post(owner, fields, [], 200)).json()).id, id);
  await post(other, { owner_ref: owner.id }, [], 409);
  const second = await (await post(owner)).json();
  await post(other);
  const own = await json(feedback + "/mine", { cookie: owner.cookie });
  assert.equal(own.feedback.length, 2);
  assert.equal((await json(feedback, { cookie: owner.cookie })).feedback.length, 2);
  await request(feedback + "/mine", { status: 401 });
  for (const [suffix, method] of [["", "GET"], ["/read", "POST"], ["/reopen", "POST"], ["", "DELETE"]]) {
    await request(feedback + "/" + id + suffix, { cookie: other.cookie, method, status: 404 });
  }
  await request(feedback + "/" + id + "/reopen", { cookie: owner.cookie, method: "POST", status: 409 });
  for (const [suffix, method] of [["", "GET"], ["/" + id + "/status", "POST"], ["/" + id + "/attachments/0", "GET"]]) {
    await request(internal + suffix, { cookie: owner.cookie, method, status: 401 });
    await request(internal + suffix, { bearer: randomUUID(), method, status: 401 });
    delete process.env.PINKY_METRICS_ADMIN_TOKEN;
    try { await request(internal + suffix, { method, status: 503 }); }
    finally { process.env.PINKY_METRICS_ADMIN_TOKEN = token; }
  }
  const { items } = await json(internal, admin);
  const row = items.find((item) => item.id === id);
  assert.ok(row && row.user_ref);
  for (const key of ["text", "kind", "status", "context", "attachments", "public_note", "duplicate_of", "fix_commit", "created_at", "updated_at"]) {
    assert.ok(Object.hasOwn(row, key), key);
  }
  assert.equal(row.status, "received");
  assert.equal(row.user_ref, items.find((item) => item.id === second.id).user_ref);
  assert.equal(new Set(items.map((item) => item.user_ref)).size, 2);
  const serialized = JSON.stringify(items);
  for (const value of [owner.name, owner.email, other.name, other.email, privateAction, unknownField]) {
    assert.ok(!serialized.includes(value), "internal output contains only consented fields and opaque identity");
  }
  assert.equal(row.context.view, context.view);
  assert.equal(row.context.web_commit, context.web_commit);
  assert.deepEqual(row.context.failed_requests, context.failed_requests);
  assert.equal((await json(internal + "?limit=1", admin)).items.length, 1);

  const since = new Date().toISOString();
  // Ensure this update has a later timestamp even on a coarse platform clock.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const statusPath = internal + "/" + id + "/status";
  await request(statusPath, { ...admin, body: { status: "unknown" }, status: 400 });
  const update = { status: "shipped", public_note: "Fixture release note", fix_commit: "b".repeat(40) };
  await request(statusPath, { ...admin, body: update });
  const filtered = await json(internal + "?status=shipped&since=" + encodeURIComponent(since), admin);
  assert.deepEqual(filtered.items.map((item) => item.id), [id]);
  assert.equal(filtered.items[0].fix_commit, update.fix_commit);
  assert.equal((await json(internal + "?since=2099-01-01T00%3A00%3A00.000Z", admin)).items.length, 0);
  assert.equal((await json(feedback + "/mine?unread=count", { cookie: owner.cookie })).unread, 1);
  assert.equal((await json(feedback + "/mine?unread=count", { cookie: other.cookie })).unread, 0);
  const detail = (await json(feedback + "/" + id, { cookie: owner.cookie })).feedback;
  assert.equal(detail.status, "shipped");
  assert.equal(detail.public_note, update.public_note);
  assert.equal(detail.unread, true);
  assert.ok(Date.parse(detail.updatedAt) >= Date.parse(detail.createdAt));
  await request(feedback + "/" + id + "/read", { cookie: owner.cookie, body: { updatedAt: detail.updatedAt } });
  await request(statusPath, { ...admin, body: update });
  assert.equal((await json(feedback + "/mine?unread=count", { cookie: owner.cookie })).unread, 0);
  assert.deepEqual(pushes.map((push) => push.userId), [owner.id]);
  assert.ok(!JSON.stringify(pushes).includes("Fixture symptom"));
  const reopened = await json(feedback + "/" + id + "/reopen", { cookie: owner.cookie, method: "POST" });
  assert.equal(reopened.feedback.status, "reopened");
  await request(feedback + "/" + id, { cookie: owner.cookie, method: "DELETE", status: 204 });
  await request(feedback + "/" + id, { cookie: owner.cookie, status: 404 });
  assert.ok(!(await json(internal, admin)).items.some((item) => item.id === id));
});

test("feedback accepts the four image formats, re-encodes each without metadata, and cleans up their files", async (t) => {
  const { register, post, request, json, media, token } = await fixture(t);
  const owner = await register(), other = await register();
  // feedback-solid.heic is a generated 16x16 solid colour image encoded with libheif.
  const images = [
    new Blob([await pixel().png().toBuffer()], { type: "image/png" }),
    new Blob([await pixel().withExif({ IFD0: { Artist: "fixture-only" } }).jpeg().toBuffer()], { type: "image/jpeg" }),
    new Blob([await pixel().webp().toBuffer()], { type: "image/webp" }),
    new Blob([await readFile(new URL("./fixtures/feedback-solid.heic", import.meta.url))], { type: "image/heic" }),
  ];
  assert.ok((await sharp(Buffer.from(await images[1].arrayBuffer())).metadata()).exif);
  const { id } = await (await post(owner, {}, images)).json();
  const attachment = internal + "/" + id + "/attachments/";
  assert.equal((await json(internal, { bearer: token })).items[0].attachments.length, 4);
  for (let index = 0; index < images.length; index++) {
    const response = await request(attachment + index, { bearer: token });
    assert.equal(response.headers.get("content-type"), "image/webp");
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.deepEqual([metadata.width, metadata.height], [16, 16]);
    const pixels = await sharp(bytes).raw().toBuffer();
    assert.ok(Math.abs(pixels[1] - 100) < 15 && Math.abs(pixels[2] - 200) < 15);
  }
  await request(attachment + 4, { bearer: token, status: 404 });
  await request(feedback + "/" + id + "/attachments/0", { cookie: other.cookie, status: 404 });
  await post(owner, {}, [...images, images[0]], 400);
  await post(owner, {}, [new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" })], 413);
  await post(owner, {}, [new Blob(["unreadable"], { type: "image/jpeg" })], 400);
  const gif = await pixel().gif().toBuffer();
  await post(owner, {}, [new Blob([gif], { type: "image/gif" })], 400);
  await post(owner, {}, [new Blob([gif], { type: "image/png" })], 400);
  await post(owner, { text: "  " }, [images[0]], 400);
  await post(owner, { text: "x".repeat(4001) }, [], 400);
  const mediaFiles = async () => {
    try { return (await readdir(media, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).length; }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  };
  assert.equal(await mediaFiles(), 4);
  const extra = await (await post(owner, {}, [images[0]])).json();
  await request(feedback + "/" + extra.id, { cookie: owner.cookie, method: "DELETE", status: 204 });
  assert.equal(await mediaFiles(), 4);
  await request("/api/privacy/account", { method: "DELETE", cookie: owner.cookie, body: { confirm: true, password: owner.password }, status: 204 });
  assert.equal(await mediaFiles(), 0);
  await request(attachment + 0, { bearer: token, status: 404 });
  assert.equal((await json(internal, { bearer: token })).items.length, 0);
});

test("feedback caps each reporter at five in ten minutes and twenty in a day across retries and deletes", async (t) => {
  const { register, post, request } = await fixture(t);
  const owner = await register(), other = await register();
  const start = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const fields = { client_id: randomUUID() };
  const { id } = await (await post(owner, fields)).json();
  const burst = await Promise.all(Array.from({ length: 5 }, () => post(owner, {}, [], [201, 429])));
  assert.deepEqual(burst.map((res) => res.status).sort(), [201, 201, 201, 201, 429]);
  assert.equal((await (await post(owner, fields, [], 200)).json()).id, id);
  const blocked = await post(owner, {}, [], 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  await request(feedback + "/" + id, { cookie: owner.cookie, method: "DELETE", status: 204 });
  await post(owner, {}, [], 429);
  await post(other);
  for (let batch = 1; batch <= 3; batch++) {
    t.mock.timers.setTime(start + batch * 11 * 60_000);
    await Promise.all(Array.from({ length: 5 }, () => post(owner)));
  }
  t.mock.timers.setTime(start + 45 * 60_000);
  await post(owner, {}, [], 429);
  t.mock.timers.setTime(start + 25 * 60 * 60_000);
  await post(owner);
});
