import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as osConstants, setPriority, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// The couple's own character (the founder, 11-03): a photo of their pet, a screenshot or any figure they like is cut out,
// checked to be whole, and given a short idle motion by Seedance; it floats at the top of the conversation for both.
// One per couple, shared by both members (visibility "shared"), uploaded by one of them (recorded as provenance).
// Hiding it is each member's own display choice. The pictures are made by this server in the background: it runs on
// the founder's computer during dogfooding, which has the GPU environment; elsewhere making is reported unavailable.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAGIC = {
  "image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (bytes) => bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
};
const MAX_BYTES = 8 * 1024 * 1024, DAILY_MAKES = 8, DAY = 24 * 60 * 60_000;
// A making older than this was lost (the server restarted mid-way): it is reported as failed so a new one can start.
const STALE_MS = 30 * 60_000;
const WORKING = new Set(["cutting", "moving"]);
const FILES = { "still.png": "image/png", "motion.webp": "image/webp" };
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const recordId = (relationshipId) => `character:${relationshipId}`;
const mediaDirectory = () => process.env.TOWARD_US_DATA_FILE ? `${process.env.TOWARD_US_DATA_FILE}.media` : join(tmpdir(), "pinky-media");
const folderFor = (fileId) => join(mediaDirectory(), "characters", fileId);
const stale = (making) => WORKING.has(making?.state) && Date.now() - Date.parse(making.startedAt) > STALE_MS;

/** What one member sees: the pictures on screen, how the latest making is going, and their own show/hide choice. */
export function characterView(record, userId) {
  if (!record) return null;
  let making = record.making ? { state: record.making.state, error: record.making.error || null } : null;
  if (stale(record.making)) making = { state: "failed", error: record.making.state === "moving" ? "motion_failed" : "failed" };
  if (making?.state === "done") making = null;
  const base = (file) => `/api/character/files/${record.current.fileId}/${file}`;
  return {
    image: record.current ? { still: base("still.png"), motion: record.current.motion ? base("motion.webp") : null } : null,
    making,
    uploadedByMe: record.uploadedByUserId === userId,
    visible: !(record.hiddenBy || []).includes(userId),
  };
}

// `emit` tells both members' open Apps that the character changed, so it appears for the partner without a reload.
export function createCharacterRouter({ store, maker = createCharacterMaker(), emit = () => {} }) {
  const router = express.Router();
  let queue = Promise.resolve(); // one making at a time on this computer: the GPU is shared with everything else
  router.use("/character", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "sign_in" }));
  const couple = async (userId) => {
    const context = await store.getRelationshipContext(userId);
    if (!(context?.relationship.status === "active" && context.members.length === 2)) throw fail(409, "pair_first");
    return context;
  };
  const current = async (userId) => {
    const context = await store.getRelationshipContext(userId);
    return context ? store.getRelationshipRecordForUser("characters", recordId(context.relationship.id), userId) : null;
  };

  router.get("/character", async (req, res) => {
    res.set("cache-control", "no-store").json({ character: characterView(await current(req.auth.user.id), req.auth.user.id) });
  });

  // A new photo, sent by one member after choosing "Make it our character". The answer comes at once; the pictures follow.
  router.post("/character", express.raw({ type: Object.keys(TYPES), limit: MAX_BYTES }), async (req, res) => {
    const userId = req.auth.user.id, mime = String(req.headers["content-type"] || "").split(";")[0].trim();
    if (!TYPES[mime] || !Buffer.isBuffer(req.body) || req.body.length < 12 || !MAGIC[mime](req.body)) throw fail(400, "unreadable");
    const context = await couple(userId);
    if (!maker.available()) throw fail(503, "unavailable");
    const id = recordId(context.relationship.id), fileId = randomUUID(), now = new Date().toISOString();
    const making = { fileId, state: "cutting", error: null, startedAt: now, byUserId: userId };
    let record;
    await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
      const existing = await tx.getRelationshipRecordForUser("characters", id, userId);
      if (existing && WORKING.has(existing.making?.state) && !stale(existing.making)) throw fail(409, "busy");
      const makes = (existing?.makes || []).filter((at) => Date.now() - Date.parse(at) < DAY);
      if (makes.length >= DAILY_MAKES) throw fail(429, "limit");
      await mkdir(folderFor(fileId), { recursive: true });
      await writeFile(join(folderFor(fileId), `photo.${TYPES[mime]}`), req.body);
      const fields = { making, makes: [...makes, now], uploadedByUserId: userId, uploadedAt: now };
      if (existing) {
        record = await tx.updateRelationshipRecordForUser("characters", id, userId, (draft) => {
          Object.assign(draft, fields);
          draft.ownerUserId = userId;
          draft.provenance = { source: "member_upload", createdByUserId: userId, createdAt: now };
          draft.version += 1;
        });
      } else {
        record = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "shared", aiAccessScope: "none", provenanceSource: "member_upload", current: null, hiddenBy: [], ...fields });
        record.id = id;
        await tx.createRelationshipRecord("characters", record);
      }
    });
    res.status(202).json({ character: characterView(record, userId) });
    emit(record, "character.updated");
    queue = queue.then(() => make({ store, maker, emit, id, userId, fileId, photo: join(folderFor(fileId), `photo.${TYPES[mime]}`) })).catch(() => {});
  });

  // Each member's own choice: hidden means gone from their screen, until they turn it back on in Settings.
  router.post("/character/display", async (req, res) => {
    const userId = req.auth.user.id;
    if (typeof req.body?.visible !== "boolean") throw fail(400, "visible_required");
    const context = await couple(userId);
    const updated = await store.updateRelationshipRecordForUser("characters", recordId(context.relationship.id), userId, (draft) => {
      const others = (draft.hiddenBy || []).filter((member) => member !== userId);
      draft.hiddenBy = req.body.visible ? others : [...others, userId];
    });
    if (!updated) throw fail(404, "not_found");
    res.json({ character: characterView(updated, userId) });
  });

  // The pictures, only to the two members of the couple, and only the character currently on screen.
  router.get("/character/files/:fileId/:name", async (req, res) => {
    const { fileId, name } = req.params;
    const record = /^[0-9a-f-]{36}$/.test(fileId) && FILES[name] ? await current(req.auth.user.id) : null;
    if (!record?.current || record.current.fileId !== fileId || (name === "motion.webp" && !record.current.motion)) throw fail(404, "not_found");
    const bytes = await readFile(join(folderFor(fileId), name)).catch(() => null);
    if (!bytes) throw fail(404, "not_found");
    res.set({ "content-type": FILES[name], "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" }).send(bytes);
  });

  router.use((error, _req, res, next) => error.statusCode ? res.status(error.statusCode).json({ error: error.message }) : error.type === "entity.too.large" ? res.status(413).json({ error: "too_large" }) : next(error));
  return router;
}

/** One making, in the background: cut out (the still shows at once), then the motion. A newer photo makes this one moot. */
async function make({ store, maker, emit, id, userId, fileId, photo }) {
  const folder = folderFor(fileId);
  // Writes only while this making is still the latest one; a member may have sent another photo meanwhile.
  const update = async (change) => emit(await store.updateRelationshipRecordForUser("characters", id, userId, (draft) => { if (draft.making?.fileId === fileId) { change(draft); draft.version += 1; } }), "character.updated");
  let cut;
  try { cut = await maker.cutOut(photo, folder); } catch (error) { console.error(`Character cut-out failed (${error?.name || "Error"}).`); cut = "failed"; }
  await rm(photo, { force: true }); // the original photo is not kept, only the cut-out character
  if (cut !== "ok") {
    await update((draft) => { draft.making.state = "failed"; draft.making.error = ["cut_off", "no_subject"].includes(cut) ? cut : "failed"; });
    await rm(folder, { recursive: true, force: true });
    return;
  }
  let previous = null;
  await update((draft) => { previous = draft.current?.fileId || null; draft.current = { fileId, motion: false }; draft.making.state = "moving"; });
  if (previous && previous !== fileId) await rm(folderFor(previous), { recursive: true, force: true });
  let moved = false;
  try { await maker.animate(join(folder, "still.png"), folder); moved = existsSync(join(folder, "motion.webp")); } catch (error) { console.error(`Character motion failed (${error?.name || "Error"}: ${String(error?.message || "").slice(0, 80)}).`); }
  // Without a motion the still stays the character; only the moving picture is missing.
  await update((draft) => {
    if (moved && draft.current?.fileId === fileId) draft.current.motion = true;
    draft.making.state = moved ? "done" : "failed";
    draft.making.error = moved ? null : "motion_failed";
  });
}

// ---- the real maker: tools/character/pipeline.py in the GPU environment, and Seedance (through Replicate) for motion.
const PYTHON = process.env.CHARACTER_PYTHON || "E:\\local-ai\\wan22\\venv\\Scripts\\python.exe";
const PIPELINE = join(root, "tools", "character", "pipeline.py");
const KEY_FILE = process.env.SEEDANCE_KEY_FILE || "E:\\CodexData\\.codex\\private\\replicate.key";
const REPLICATE = "https://api.replicate.com/v1";
const SEEDANCE_MODEL = process.env.SEEDANCE_MODEL || "bytedance/seedance-1-lite";
const AGENT = "pinky-character/1.0"; // Replicate's firewall refuses some default agents (403, error 1010)
// The creature's own natural idle, so a dog moves like a dog; never a shadow or a floor (the founder, 11-03).
const PROMPT = "The character stays in place and idles naturally, with the small lifelike movements typical of what it is: breathing, blinking, a slight turn of the head. Static camera, plain solid green background, flat even light, no shadow and no floor: the character alone.";
const CUT_OFF = 3, NO_SUBJECT = 4;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One pipeline step, at below-normal priority so the founder's computer stays responsive. Resolves to the exit code. */
function step(...args) {
  return new Promise((done) => {
    const child = spawn(PYTHON, ["-I", PIPELINE, ...args], { stdio: "ignore", windowsHide: true });
    try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Runs at normal priority. */ }
    const timer = setTimeout(() => child.kill(), 20 * 60_000);
    child.on("error", () => { clearTimeout(timer); done(-1); });
    child.on("exit", (code) => { clearTimeout(timer); done(code ?? -1); });
  });
}

async function replicate(url, key, body) {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": AGENT }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Replicate answered ${response.status}`);
  return response.json();
}

/** Seedance image-to-video from the green first frame, 4 s at 480p (about $0.07). The token is read here and nowhere else. */
async function seedance(firstFrame, clip) {
  const key = (await readFile(KEY_FILE, "utf8")).trim();
  if (!key) throw new Error("No Replicate token");
  // Only the first frame: the same picture as the last frame too is refused (E006).
  let run = await replicate(`${REPLICATE}/models/${SEEDANCE_MODEL}/predictions`, key, { input: { prompt: PROMPT, image: `data:image/png;base64,${(await readFile(firstFrame)).toString("base64")}`, duration: 4, resolution: "480p" } });
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    if (run.status === "succeeded") {
      const output = Array.isArray(run.output) ? run.output[0] : run.output;
      if (typeof output !== "string" || !output.startsWith("https://")) throw new Error("Seedance gave no video");
      const response = await fetch(output, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(120_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || !bytes.length || bytes.length > 50_000_000) throw new Error("Seedance video could not be downloaded");
      await writeFile(clip, bytes);
      return;
    }
    if (["failed", "canceled"].includes(run.status)) throw new Error(`Seedance run ${run.status}`);
    await sleep(5000);
    run = await replicate(`${REPLICATE}/predictions/${encodeURIComponent(run.id)}`, key);
  }
  throw new Error("Seedance run timed out");
}

export function createCharacterMaker() {
  // CHARACTER_MAKER=fake, for end-to-end tests and local walk-throughs: the photo itself stands in for the cut-out and the
  // motion, so the whole couple path runs without the GPU environment and without a paid Seedance call.
  if (process.env.CHARACTER_MAKER === "fake") return {
    available: () => true,
    async cutOut(photo, folder) { await copyFile(photo, join(folder, "still.png")); return "ok"; },
    async animate(still, folder) { await copyFile(still, join(folder, "motion.webp")); },
  };
  return {
    available: () => process.env.CHARACTER_MAKER !== "off" && existsSync(PYTHON) && existsSync(PIPELINE),
    /** "ok" with still.png written, or "cut_off" / "no_subject"; throws when the step itself broke. */
    async cutOut(photo, folder) {
      const code = await step("looks", photo, folder);
      if (code === CUT_OFF) return "cut_off";
      if (code === NO_SUBJECT) return "no_subject";
      if (code !== 0 || !existsSync(join(folder, "look-0.png"))) throw new Error(`Cut-out exited ${code}`);
      await copyFile(join(folder, "look-0.png"), join(folder, "still.png"));
      return "ok";
    },
    /** Writes motion.webp: a transparent loop that plays forward then back. Throws when any step fails. */
    async animate(still, folder) {
      if (await step("green", still, join(folder, "green.png"))) throw new Error("Green frame failed");
      await seedance(join(folder, "green.png"), join(folder, "clip.mp4"));
      if (await step("loop", join(folder, "clip.mp4"), join(folder, "motion.webp"), "pingpong")) throw new Error("Loop failed");
      await Promise.all(["green.png", "clip.mp4", "look-0.png"].map((name) => rm(join(folder, name), { force: true })));
    },
  };
}
