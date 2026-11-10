// Memory eval (founder 11-09: "先搭测试集"): writes months of private chats into fresh local accounts the way the App keeps
// them (chunk by chunk, each chunk scanned for notes as it arrives, older lines moved into pages and summarised), asks one
// question through the real assistant turn, and grades the answer with a judge against what it must and must not say.
// Local only, through the founder's Claude CLI; no API keys, never the dogfood server or a real account.
//   npm run eval:memory -- [--label before] [--only id1,id2] [--concurrency 2] [--baseline]
// --baseline also asks each question of an account with no history, to show what memory adds.
// --no-portraits skips the standing portraits (画像层), to measure what they add; --no-tidy skips the background tidy (整理).
// Writes work/memory-eval/<label>-<time>/report.{json,md}.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "claude-cli") throw new Error("eval:memory runs only with AI_PROVIDER=claude-cli.");
process.env.AI_PROVIDER = "claude-cli";
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[name];

const { values: options } = parseArgs({ options: { label: { type: "string", default: "run" }, only: { type: "string" }, concurrency: { type: "string", default: "2" }, baseline: { type: "boolean", default: false }, "no-portraits": { type: "boolean", default: false }, "no-tidy": { type: "boolean", default: false } } });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(process.cwd(), "work", "memory-eval", `${options.label}-${stamp}`);
await mkdir(directory, { recursive: true });
// Chats sent in a person's own conversation keep their files beside this run's store; nothing outside it is touched.
process.env.TOWARD_US_MEDIA_DIR = join(directory, "media");

const { createApiApp } = await import("../server/app.mjs");
const { createFileStore } = await import("../server/store.mjs");
const { createMediator } = await import("../server/mediator.mjs");
const { personFor, listPeople, personSubject } = await import("../server/people.mjs");
const { createRelationshipRecord } = await import("../server/relationship-domain.mjs");
const { scanPrivateProfile } = await import("../server/profile.mjs");
const { keepMessages, summarizeEarlier } = await import("../server/thread-pages.mjs");
const { refreshPortraits } = await import("../server/portraits.mjs");
const { tidyMemory } = await import("../server/memory-tidy.mjs");
const { cases, FILLER } = await import("./memory-eval/cases.mjs");
const { judgeSchema, judgeInstructions, validateCases, grade, caseResult, summarize } = await import("./memory-eval/score.mjs");

const problems = validateCases(cases);
if (problems.length) throw new Error(`cases.mjs is not well-formed:\n${problems.join("\n")}`);
const wanted = options.only ? new Set(options.only.split(",")) : null;
const selected = cases.filter((item) => !wanted || wanted.has(item.id));

const model = createMediator({ apiKey: "" });
const store = await createFileStore(join(directory, "state.json"));
const server = createApiApp({ store, mediator: model }).listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${server.address().port}`;
let accounts = 0;

async function call(path, body, cookie, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result).slice(0, 200)}`);
  return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function account(name) {
  const { result, cookie } = await call("/auth/register", { name, email: `memory-eval-${++accounts}-${randomUUID().slice(0, 8)}@example.test`, password: "eval only, local test store" });
  return { user: result.user, cookie };
}
const DAY = 24 * 60 * 60 * 1000;

/** The member's lines in time order: the case's history among ordinary days. */
function timeline(item, thread) {
  const lines = (item.history || []).filter((line) => line.thread === thread).map((line) => ({ day: line.day, text: line.text }));
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
      return [{ id: randomUUID(), role: "user", text: line.text, itemId: randomUUID(), createdAt: at.toISOString() }, { id: randomUUID(), role: "assistant", text: "嗯，我在听。", createdAt: new Date(at.getTime() + 500).toISOString() }];
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

async function ask(setup, item) {
  const asker = item.probe.as === "partner" ? setup.partner : setup.me;
  const answers = [];
  for (let round = 0; round < (item.probe.repeat || 1); round += 1) {
    // A partner asks in a new conversation each time, as they would on different days.
    const sessionId = item.probe.as === "partner" ? (await call("/assistant/sessions", { language: "zh", timezone: "Asia/Shanghai" }, asker.cookie)).result.session.id : await setup.open(item.probe.thread);
    const text = item.probe.text.replace(/\{date:(-?\d+)\}/g, (_, days) => new Date(Date.now() + Number(days) * DAY).toISOString().slice(0, 10));
    const { result } = await call(`/assistant/sessions/${sessionId}/messages`, { text, itemId: randomUUID() }, asker.cookie);
    const messages = result.session.messages, asked = messages.findLastIndex((message) => message.role === "user");
    const answer = messages.slice(asked + 1).filter((message) => message.role === "assistant" && !message.kind).map((message) => message.text).join("\n");
    const verdict = await model.structured({ name: "memory_judge", schema: judgeSchema, instructions: judgeInstructions, input: JSON.stringify({ question: text, answer, must: item.expect.must, mustNot: item.expect.mustNot || [], abstain: Boolean(item.expect.abstain), record: [...(item.history || []).map((line) => ({ daysAgo: -line.day, text: line.text })), ...(item.notes || []).map((note) => ({ daysAgo: -note.day, text: `${note.about}: ${note.text}` }))] }), maxOutputTokens: 800 });
    answers.push({ answer, verdict, grade: grade(item, verdict) });
  }
  return answers;
}

async function check(setup, item) {
  if (!item.check) return null;
  const records = (await store.listRelationshipRecordsForUser("memories", setup.me.user.id)).filter((record) => record.kind === "profile");
  const live = (pattern) => records.filter((record) => record.status === "active" && new RegExp(pattern).test(String(record.text)));
  // noFact: nothing like it kept. atMost: duplicates folded down to this many. superseded: kept, but marked no longer true.
  if (item.check.noFact) { const kept = live(item.check.noFact); return { ok: !kept.length, kept: kept.map((record) => record.text), problem: "不该记却记了" }; }
  if (item.check.atMost) { const kept = live(item.check.atMost.pattern); return { ok: kept.length <= item.check.atMost.count, kept: kept.map((record) => record.text), problem: `重复没合并（最多 ${item.check.atMost.count} 条）` }; }
  if (item.check.superseded) { const old = records.filter((record) => new RegExp(item.check.superseded).test(String(record.text))); return { ok: old.length > 0 && old.every((record) => record.status === "archived" && record.supersededBy), kept: old.map((record) => `${record.text}（${record.status}）`), problem: "旧事实没标成已失效" }; }
  return null;
}

async function runCase(item) {
  const started = Date.now();
  try {
    const setup = await setupCase(item, true);
    const answers = await ask(setup, item);
    const result = caseResult(item, answers, await check(setup, item));
    const everyone = await listPeople(store, setup.me.user.id, { archived: true });
    const people = everyone.map((person) => person.name);
    // What the account kept, for reading a failure: each note with whom it is about, and each conversation's summary.
    const whose = (subject) => subject === setup.me.user.id ? "me" : everyone.find((person) => `person:${person.id}` === subject)?.name || (subject ? "partner" : "us");
    const kept = (await store.listRelationshipRecordsForUser("memories", setup.me.user.id)).filter((record) => record.kind === "profile" && record.status === "active").map((record) => `${whose(record.subjectUserId)}·${record.category}: ${record.text}`);
    const summaries = (await store.listRelationshipRecordsForUser("privateAgentThreads", setup.me.user.id)).filter((thread) => thread.earlierSummary).map((thread) => thread.earlierSummary);
    let baseline = null;
    if (options.baseline) { const empty = await setupCase(item, false); const plain = await ask(empty, { ...item, probe: { ...item.probe, repeat: 1 } }); baseline = caseResult(item, plain); baseline.answers = plain; }
    return { ...result, answers, people, kept, summaries, baseline, ms: Date.now() - started };
  } catch (error) {
    return { id: item.id, category: item.category, pass: false, points: 0, error: String(error?.message || error).slice(0, 400), ms: Date.now() - started };
  }
}

const results = new Array(selected.length);
let next = 0;
const worker = async () => { while (next < selected.length) { const index = next++; results[index] = await runCase(selected[index]); process.stdout.write(results[index].error ? "x" : results[index].pass ? "." : "F"); } };
try { await Promise.all(Array.from({ length: Math.max(1, Number(options.concurrency) || 1) }, worker)); }
finally { await new Promise((resolve) => server.close(resolve)); }
process.stdout.write("\n");

const totals = summarize(results);
const baselineTotals = options.baseline ? summarize(results.filter((result) => result.baseline).map((result) => result.baseline)) : null;
const report = { label: options.label, at: new Date().toISOString(), model: model.model, ...totals, baseline: baselineTotals, results };
const percent = (value) => `${Math.round(value * 100)}%`;
const md = [
  `# 记忆测试：${report.label}`, "",
  `${report.at} · ${report.model} · ${report.cases} 个场景 · 通过 ${report.passed}（${percent(report.passRate)}）${baselineTotals ? ` · 无记忆基线通过 ${baselineTotals.passed}（${percent(baselineTotals.passRate)}）` : ""}`, "",
  "| 类别 | 场景 | 通过 | 要点得分 |", "|---|---|---|---|",
  ...Object.values(totals.byCategory).map((row) => `| ${row.name} | ${row.cases} | ${row.passed} | ${percent(row.points)} |`), "",
  ...results.flatMap((result) => [
    `## ${result.pass ? "✓" : "✗"} ${result.id}（${result.category}）`,
    ...(result.error ? [`错误：${result.error}`] : [
      ...result.answers.map((answer, index) => `- 回答${result.answers.length > 1 ? ` ${index + 1}` : ""}：${answer.answer.replace(/\n/g, " ").slice(0, 400)}\n  - 要点：${(answer.verdict?.must || []).map((entry) => `${entry.score} ${entry.point}`).join("；")}${answer.grade.violations.length ? `\n  - **违规**：${answer.grade.violations.join("；")}` : ""}${answer.grade.abstainOk ? "" : "\n  - **该说不知道却没说**"}`),
      ...(result.check ? [`- 记忆检查：${result.check.ok ? "通过" : `${result.check.problem}：${result.check.kept.join("；")}`}`] : []),
      ...(result.pass ? [] : [`- 记下的：${(result.kept || []).join("；").slice(0, 600) || "（无）"}`, ...(result.summaries?.length ? [`- 旧对话摘要：${result.summaries.join(" / ").slice(0, 400)}`] : [])]),
      ...(result.baseline ? [`- 无记忆基线：${result.baseline.pass ? "通过" : "不通过"}（要点 ${percent(result.baseline.points)}）`] : []),
    ]), ""]),
].join("\n");
await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(directory, "report.md"), md);
await rm(join(directory, "state.json"), { force: true });
await rm(join(directory, "media"), { recursive: true, force: true });
console.log(`${report.passed}/${report.cases} passed${baselineTotals ? ` (no-memory baseline ${baselineTotals.passed}/${baselineTotals.cases})` : ""} → ${join(directory, "report.md")}`);
process.exit(0);
