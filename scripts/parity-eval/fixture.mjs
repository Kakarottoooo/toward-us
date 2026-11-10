import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createApiApp } from "../../server/app.mjs";
import { createFileStore } from "../../server/store.mjs";
import { createMediator } from "../../server/mediator.mjs";
import { createReminderService } from "../../server/reminder-service.mjs";
import { personFor, personSubject } from "../../server/people.mjs";
import { createRelationshipRecord } from "../../server/relationship-domain.mjs";
import { scanPrivateProfile } from "../../server/profile.mjs";
import { keepMessages, summarizeEarlier } from "../../server/thread-pages.mjs";
import { refreshPortraits } from "../../server/portraits.mjs";
import { tidyMemory } from "../../server/memory-tidy.mjs";
import { FILLER } from "../memory-eval/cases.mjs";
import { recordChecks } from "./evidence.mjs";

// Same synthetic-account seeding protocol as eval-memory, reusing production memory helpers.
export async function createHarness(directory, { requestContext } = {}) {
  const options = {};
  const model = createMediator({ apiKey: "" });
  const store = await createFileStore(`${directory}/state.json`);
  const app = createApiApp({ store, mediator: model, reminderService: createReminderService({ store }) });
  // HTTP server callbacks do not inherit the client's AsyncLocalStorage. Carry only synthetic case/phase IDs.
  const server = createServer((req, res) => requestContext
    ? requestContext.run({ case: req.headers["x-parity-case"] || null, phase: req.headers["x-parity-phase"] || null }, () => app(req, res))
    : app(req, res)).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let accounts = 0;
  async function call(path, body, cookie, method = body ? "POST" : "GET", mime = "application/json") {
    const tag = requestContext?.getStore();
    const response = await fetch(`${base}/api${path}`, { method, signal: AbortSignal.timeout(660_000), headers: { "content-type": mime, ...(cookie ? { cookie } : {}), ...(tag?.case ? { "x-parity-case": tag.case, "x-parity-phase": tag.phase } : {}) }, ...(body ? { body: mime === "application/json" ? JSON.stringify(body) : body } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${path.split("?")[0]}: HTTP ${response.status} ${JSON.stringify(result).slice(0, 160)}`);
    return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function account(name) {
    const { result, cookie } = await call("/auth/register", { name, email: `parity-${++accounts}-${randomUUID()}@example.test`, password: "synthetic local parity only" });
    return { user: result.user, cookie };
  }
const DAY = 24 * 60 * 60 * 1000;

/** The member's lines in time order: the case's history among ordinary days. */
function timeline(item, thread) {
  const lines = (item.history || []).filter((line) => line.thread === thread).map((line) => ({ day: line.day, text: line.text, reply: line.reply }));
  const filler = item.filler?.thread === thread ? item.filler : null;
  if (filler) for (let index = 0; index < filler.count; index += 1) lines.push({ day: filler.from + (filler.to - filler.from) * (index / Math.max(1, filler.count - 1)), text: FILLER[index % FILLER.length] });
  return lines.sort((a, b) => a.day - b.day);
}

/** Writes one conversation's past the way the App would have: 40 lines at a time, each batch scanned for notes. */
async function seed(userId, sessionId, lines) {
  const now = Date.now();
  for (let start = 0; start < lines.length; start += 40) {
    const chunk = lines.slice(start, start + 40).flatMap((line, index) => {
      const at = new Date(now + line.day * DAY + index * 1000);
      return [{ id: randomUUID(), role: "user", text: line.text, itemId: randomUUID(), createdAt: at.toISOString() }, { id: randomUUID(), role: "assistant", text: line.reply ?? "嗯，我在听。", createdAt: new Date(at.getTime() + 500).toISOString() }];
    });
    await store.transaction(`user:${userId}`, (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", sessionId, userId, (draft) => {
      if (!draft.profileScan) draft.profileScan = { at: new Date(0).toISOString() };
      keepMessages(draft, [...draft.messages, ...chunk]); draft.version += 1;
    }));
    for (let round = 0; round < 4; round += 1) { const changed = await scanPrivateProfile({ store, mediator: model, userId, sessionId }); if (!changed?.more) break; }
  }
  await summarizeEarlier({ store, mediator: model, userId, sessionId });
}

async function setupCase(item, withHistory) {
  const pair = item.paired || null;
  const me = await account(pair?.me || "小安");
  let partner = null;
  if (pair) {
    partner = await account(pair.partner);
    const invitation = await call("/partner/invitations", {}, me.cookie);
    await call("/partner/accept", { code: invitation.result.pairing.invitation.code }, partner.cookie);
  }
  const people = {};
  for (const name of item.people || []) people[name] = await store.transaction(`user:${me.user.id}`, (tx) => personFor(tx, me.user.id, name));
  const sessions = {};
  const open = async (thread, who = me) => {
    if (sessions[`${thread}:${who.user.id}`]) return sessions[`${thread}:${who.user.id}`];
    const body = { language: "zh", timezone: "Asia/Shanghai", ...(thread !== "main" && thread !== "partner" ? { personId: people[thread].id } : {}) };
    return (sessions[`${thread}:${who.user.id}`] = (await call("/assistant/sessions", body, who.cookie)).result.session.id);
  };
  if (withHistory) {
    for (const thread of new Set([...(item.history || []).map((line) => line.thread), ...(item.filler ? [item.filler.thread] : [])])) {
      const who = thread === "partner" ? partner : me;
      await seed(who.user.id, await open(thread === "partner" ? "main" : thread, who), timeline(item, thread));
    }
    // Years of notes, written as kept: each with the day it was said, older ones older.
    const notes = [...(item.notes || []), ...(item.bulkNotes ? item.bulkNotes.items.map((thing, index, all) => ({ about: item.bulkNotes.about, category: item.bulkNotes.category, text: item.bulkNotes.template.replace("{}", thing), day: item.bulkNotes.from + (item.bulkNotes.to - item.bulkNotes.from) * (index / Math.max(1, all.length - 1)) })) : [])];
    for (const note of notes) {
      const at = new Date(Date.now() + note.day * DAY).toISOString();
      await store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: me.user.id, ownerUserId: me.user.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile",
        subjectUserId: note.about === "me" ? me.user.id : personSubject(people[note.about].id), category: note.category, text: note.text.replace("{date}", at.slice(0, 10)), evidence: { channel: "private", saidAt: at }, createdAt: at, updatedAt: at }));
    }
    // The App tidies notes and redraws portraits in the background after notes change; here, once everything is in.
    if (!options["no-tidy"]) await tidyMemory({ store, mediator: model, userId: me.user.id, force: true });
    if (!options["no-portraits"]) { await refreshPortraits({ store, mediator: model, userId: me.user.id }); if (partner) await refreshPortraits({ store, mediator: model, userId: partner.user.id }); }
    for (const action of item.actions || []) if (action.type === "archive") await call(`/people/${people[action.person].id}/archive`, { archived: true }, me.cookie);
  }
  return { me, partner, people, open };
}

  async function ask(setup, item, image) {
    const asker = item.probe.as === "partner" ? setup.partner : setup.me;
    const sessionId = await setup.open(item.probe.thread, asker);
    const before = await store.relationshipSnapshotForUser(asker.user.id);
    const beforeIds = new Set(Object.values(before).flatMap((value) => Array.isArray(value) ? value.map((record) => record.id) : []));
    const peerBefore = setup.partner ? await store.relationshipSnapshotForUser(setup.partner.user.id) : null;
    const privacyChecks = [];
    if (item.check?.kind === "privacy") {
      const ownSession = await setup.open("main", setup.me);
      const denied = await fetch(`${base}/api/assistant/sessions/${ownSession}`, { headers: { cookie: setup.partner.cookie } });
      privacyChecks.push({ name: "伴侣读取私人会话被拒绝", ok: [403, 404].includes(denied.status), status: denied.status });
      const locate = await fetch(`${base}/api/assistant/sessions/${ownSession}/locate?date=2026-01-01`, { headers: { cookie: setup.partner.cookie } });
      privacyChecks.push({ name: "伴侣按日期定位私人会话被拒绝", ok: [403, 404].includes(locate.status), status: locate.status });
    }
    const photoIds = [];
    if (image) photoIds.push((await call("/photos", await readFile(image), asker.cookie, "POST", "image/png")).result.photo.id);
    if (item.modality === "file") {
      const uploaded = await call(`/imports?name=synthetic-chat.txt&language=zh&session=${sessionId}`, Buffer.from(item.assetText), asker.cookie, "POST", "application/octet-stream");
      let imported = uploaded.result.import;
      if (imported.status === "needs_people") {
        const people = imported.people.map((person, index) => ({ name: person.name, role: index === 0 ? "me" : "partner" }));
        imported = (await call(`/imports/${imported.id}/people`, { people }, asker.cookie)).result.import;
      }
      const limit = Date.now() + 240_000;
      while (imported.status === "analyzing" && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        imported = (await call(`/imports/${imported.id}`, null, asker.cookie)).result.import;
      }
      if (imported.status !== "ready") throw new Error(`Synthetic import did not finish: ${imported.status}`);
    }
    const rounds = [];
    for (let round = 0; round < (item.probe.repeat || 1); round++) {
      const progress = [];
      const poll = setInterval(() => {
        void call(`/agent/activity?channel=${item.channel === "shared" ? "us" : "me"}`, null, asker.cookie).then(({ result }) => { if (result.activity && progress.at(-1) !== result.activity.step) progress.push(result.activity.step); }).catch(() => {});
      }, 400);
      let result;
      try {
        ({ result } = await call(item.channel === "shared" ? "/together/messages" : `/assistant/sessions/${sessionId}/messages`, { text: item.question, itemId: randomUUID(), language: "zh", timezone: "Asia/Shanghai", ...(round === 0 && photoIds.length ? { photoIds } : {}) }, asker.cookie));
        if (image) {
          const limit = Date.now() + 600_000;
          while (Date.now() < limit) {
            const imports = (await call("/imports", null, asker.cookie)).result.imports;
            if (imports.length && imports.every((entry) => !["analyzing", "reading"].includes(entry.status))) break;
            if (result.session?.messages?.some((entry) => /截图没能读|截图里没有读到/.test(entry.text || ""))) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
            result = (await call(`/assistant/sessions/${sessionId}`, null, asker.cookie)).result;
          }
          result = (await call(`/assistant/sessions/${sessionId}`, null, asker.cookie)).result;
        }
      } finally { clearInterval(poll); }
      const messages = result.session?.messages || result.conversation?.messages || [];
      const asked = messages.findLastIndex((entry) => entry.role === "user" || entry.actorUserId === asker.user.id);
      const replies = messages.slice(asked + 1).filter((entry) => entry.role === "assistant" || entry.actorUserId === null);
      const answer = replies.map((entry) => entry.text || "").filter(Boolean).join("\n") || result.reply?.text || "";
      const sources = replies.flatMap((entry) => entry.sources || []);
      const sourceChecks = [];
      for (const source of sources) {
        const route = source.channel === "us" ? `/together/locate?conversationId=${encodeURIComponent(source.conversationId)}&messageId=${encodeURIComponent(source.messageId)}` : `/assistant/sessions/${encodeURIComponent(source.conversationId)}/locate?messageId=${encodeURIComponent(source.messageId)}`;
        try {
          const located = (await call(route, null, asker.cookie)).result;
          const target = located.messages?.find((entry) => entry.id === source.messageId);
          const original = (item.history || []).find((line) => line.text === target?.text || line.reply === target?.text);
          sourceChecks.push({ ok: Boolean(target && original), original: target?.text || null });
        } catch { sourceChecks.push({ ok: false }); }
      }
      rounds.push({ answer, progress, sources, sourceChecks });
    }
    let after = await store.relationshipSnapshotForUser(asker.user.id);
    // Explicit remember requests are extracted by the real background keeper after its 20-second debounce.
    // Observe that normal path; never manually force a post-answer extraction to make a case pass.
    if (item.check?.kind === "memory") {
      const limit = Date.now() + 60_000;
      while (Date.now() < limit && !((after.memories || []).some((entry) => /香菜/.test(entry.text || "")) && (after.memories || []).some((entry) => /花粉/.test(entry.text || "")))) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        after = await store.relationshipSnapshotForUser(asker.user.id);
      }
    }
    const collections = { reminder: "reminders", checkin: "checkins", memory: "memories", agreement: "agreements", space: "spaces" };
    const collection = collections[item.check?.kind];
    const created = collection ? (after[collection] || []).filter((record) => !beforeIds.has(record.id)) : [];
    const plain = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !["passwordHash", "token", "email"].includes(key)));
    let completed = item.unsupported ? false : null;
    const peer = setup.partner ? await store.relationshipSnapshotForUser(setup.partner.user.id) : null;
    const checks = collection ? recordChecks(item, created, { userId: asker.user.id, partnerId: setup.partner?.user.id, personId: setup.people[item.probe.thread]?.id, peer, spaceItems: after.spaceItems }) : [];
    if (collection) completed = checks.every((check) => check.ok);
    if (item.check?.kind === "sources") completed = rounds.every((round) => round.sources.length > 0 && round.sourceChecks.every((source) => source.ok));
    if (item.check?.kind === "privacy") completed = privacyChecks.every((check) => check.ok);
    if (item.id === "plan-private-share-boundary") {
      const shared = (snapshot) => JSON.stringify(Object.fromEntries(Object.entries(snapshot || {}).filter(([key]) => ["togetherConversations", "spaces", "spaceItems", "memories"].includes(key))));
      privacyChecks.push({ name: "未确认的辞职内容没有进入伴侣投影", ok: !shared(peer).includes("辞职") && !shared(peerBefore).includes("辞职") });
      completed = privacyChecks.every((check) => check.ok);
    }
    const sideEffects = Object.fromEntries(["reminders", "checkins", "memories", "agreements", "spaces", "spaceItems", "chatImports", "photos"].map((key) => [key, (after[key] || []).filter((record) => !beforeIds.has(record.id)).map(plain)]));
    return { answer: rounds.map((round, index) => rounds.length > 1 ? `第${index + 1}次：${round.answer}` : round.answer).join("\n"), completed, evidence: {
      rounds, persisted: created.map(plain), sideEffects, checks, privacyChecks, storedCompletion: completed, unsupported: item.unsupported || null,
      ...(image ? { imageAttached: true, transcriptProvided: false, importStatuses: (await call("/imports", null, asker.cookie)).result.imports.map((entry) => ({ status: entry.status, messageCount: entry.messageCount })) } : {}),
      modality: item.modality || "text", boundary: "本地临时账号；没有真实发送；语音仅测转写后的文本，图片走真实导入路径" } };
  }
  return { setup: (item) => setupCase(item, true), ask, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Deliberately exclude all private records owned by the other principal before constructing competitor/judge prompts.
export function visibleContext(item, at) {
  const partner = item.probe.as === "partner";
  const thread = item.probe.thread;
  const date = (day) => new Date(at + day * 86400000).toISOString().slice(0, 10);
  const history = item.channel === "shared" ? [] : (item.history || []).filter((line) => partner ? line.thread === "partner" : line.thread !== "partner" && (thread === "main" || line.thread === thread));
  const notes = partner || item.channel === "shared" ? [] : (item.notes || []).filter((note) => thread === "main" || note.about === "me" || note.about === thread);
  return { user: partner ? item.paired.partner : item.paired?.me || "小安", language: "zh", timezone: "Asia/Shanghai", now: new Date(at).toISOString(),
    history: history.map((line) => ({ date: date(line.day), thread: line.thread, question: line.text, answer: line.reply ?? "嗯，我在听。" })),
    notes: notes.map((note) => ({ about: note.about, date: date(note.day), text: note.text.replace("{date}", date(note.day)) })) };
}
