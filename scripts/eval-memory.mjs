// Memory eval (founder 11-09: "先搭测试集"): writes months of private chats into fresh local accounts the way the App keeps
// them (chunk by chunk, each chunk scanned for notes as it arrives, older lines moved into pages and summarised), asks one
// question through the real assistant turn, and grades the answer with a judge against what it must and must not say.
// Local only, through the founder's Claude CLI; no API keys, never the dogfood server or a real account.
//   npm run eval:memory -- [--label before] [--only id1,id2] [--concurrency 2] [--baseline]
// --baseline also asks each question of an account with no history, to show what memory adds.
// --no-portraits skips the standing portraits (画像层), to measure what they add; --no-tidy skips the background tidy (整理).
// --suite assistant runs the everyday assistant scenarios instead (memory-eval/assistant-cases.mjs).
// Every model call's real usage (tokens, cache reads/writes, list-price $) is recorded from the CLI's own report, per
// probe and per background kind. --compare <report.json> adds a before/after table against an earlier run.
// Writes work/memory-eval/<label>-<time>/report.{json,md}.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "claude-cli") throw new Error("eval:memory runs only with AI_PROVIDER=claude-cli.");
process.env.AI_PROVIDER = "claude-cli";
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[name];

const { values: options } = parseArgs({ options: { label: { type: "string", default: "run" }, only: { type: "string" }, concurrency: { type: "string", default: "2" }, baseline: { type: "boolean", default: false }, "no-portraits": { type: "boolean", default: false }, "no-tidy": { type: "boolean", default: false }, suite: { type: "string", default: "memory" }, compare: { type: "string" } } });
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
const { cases: memoryCases, FILLER } = await import("./memory-eval/cases.mjs");
const { assistantCases } = await import("./memory-eval/assistant-cases.mjs");
const cases = options.suite === "assistant" ? assistantCases : memoryCases;
const { usageListeners } = await import("../server/claude-cli-client.mjs");
const usage = [];
usageListeners.add((event) => usage.push(event));
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
    const replies = messages.slice(asked + 1).filter((message) => message.role === "assistant" && !message.kind);
    const answer = replies.map((message) => message.text).join("\n"), cards = replies.flatMap((message) => (message.cards || []).map((card) => card.kind));
    const verdict = await model.structured({ name: "memory_judge", schema: judgeSchema, instructions: judgeInstructions, input: JSON.stringify({ question: text, answer, must: item.expect.must, mustNot: item.expect.mustNot || [], abstain: Boolean(item.expect.abstain), record: [...(item.history || []).map((line) => ({ daysAgo: -line.day, text: line.text })), ...(item.notes || []).map((note) => ({ daysAgo: -note.day, text: `${note.about}: ${note.text}` }))] }), maxOutputTokens: 800 });
    answers.push({ asked: text, answer, cards, verdict, grade: grade(item, verdict) });
  }
  return answers;
}

async function check(setup, item, answers = []) {
  if (!item.check) return null;
  // card: what Pinky did, not only what it said.
  if (item.check.card) { const missing = answers.filter((answer) => !answer.cards.includes(item.check.card)); return { ok: !missing.length, kept: missing.map((answer) => `卡片：${answer.cards.join("、") || "无"}`), problem: `没有建${item.check.card}卡片` }; }
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
    const result = caseResult(item, answers, await check(setup, item, answers));
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

// Cost from what the CLI reported for each call. A turn is the planner call(s) answering one probe, found by the probe's
// words in its prompt (every case has its own account); everything else is counted by kind (background work, judge).
const PLANNER = "private_assistant_operations";
const tokensOf = (event) => ({ input: event.usage.input_tokens || 0, cacheWrite: event.usage.cache_creation_input_tokens || 0, cacheRead: event.usage.cache_read_input_tokens || 0, output: event.usage.output_tokens || 0, usd: event.usd });
const add = (into, event) => { const t = tokensOf(event); into.calls += 1; for (const key of ["input", "cacheWrite", "cacheRead", "output", "usd"]) into[key] += t[key]; return into; };
const empty = () => ({ calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0 });
const byKind = {};
for (const event of usage) add(byKind[event.name === PLANNER ? "planner" : event.name || "other"] ||= empty(), event);
const turns = [];
for (const result of results) {
  result.cost = empty();
  for (const answer of result.answers || []) {
    const quoted = JSON.stringify(answer.asked).slice(1, -1);
    const calls = usage.filter((event) => event.name === PLANNER && event.prompt.includes(quoted));
    const turn = calls.reduce(add, empty());
    turn.warm = calls.some((event) => (event.usage.cache_read_input_tokens || 0) > 0);
    turns.push(turn); for (const key of ["calls", "input", "cacheWrite", "cacheRead", "output", "usd"]) result.cost[key] += turn[key];
  }
}
const average = (list) => { const n = list.length || 1; return { turns: list.length, tokensIn: Math.round(list.reduce((sum, t) => sum + t.input + t.cacheWrite + t.cacheRead, 0) / n), cacheRead: Math.round(list.reduce((sum, t) => sum + t.cacheRead, 0) / n), output: Math.round(list.reduce((sum, t) => sum + t.output, 0) / n), usd: list.reduce((sum, t) => sum + t.usd, 0) / n }; };
const cost = { perTurn: average(turns), warm: average(turns.filter((t) => t.warm)), cold: average(turns.filter((t) => !t.warm)), byKind,
  background: Object.entries(byKind).filter(([kind]) => !["planner", "memory_judge"].includes(kind)).reduce((sum, [, row]) => sum + row.usd, 0) };
const money = (value) => `$${value.toFixed(4)}`;
const costLines = [
  "## 用量（CLI 实际报告）", "",
  `每轮（规划调用，含重试和检索后的第二次）：平均输入 ${cost.perTurn.tokensIn} tokens（其中缓存读 ${cost.perTurn.cacheRead}）· 输出 ${cost.perTurn.output} · ${money(cost.perTurn.usd)}；有缓存 ${cost.warm.turns} 轮 ${money(cost.warm.usd)}，无缓存 ${cost.cold.turns} 轮 ${money(cost.cold.usd)}`, "",
  "| 调用 | 次数 | 输入 | 缓存写 | 缓存读 | 输出 | 费用 |", "|---|---|---|---|---|---|---|",
  ...Object.entries(byKind).map(([kind, row]) => `| ${kind} | ${row.calls} | ${row.input} | ${row.cacheWrite} | ${row.cacheRead} | ${row.output} | ${money(row.usd)} |`), "",
];

// Before/after against an earlier report: quality per case and cost per turn.
let compareLines = [];
if (options.compare) {
  const { readFile } = await import("node:fs/promises");
  const before = JSON.parse(await readFile(options.compare, "utf8"));
  const was = new Map(before.results.map((result) => [result.id, result]));
  const changed = results.filter((result) => was.has(result.id) && was.get(result.id).pass !== result.pass);
  const b = before.cost || {};
  const row = (name, x, y, format = (value) => value) => `| ${name} | ${x === undefined ? "—" : format(x)} | ${format(y)} |`;
  compareLines = ["## 和之前对比", "", `之前：${before.label}（${before.at}）`, "", "| | 之前 | 现在 |", "|---|---|---|",
    row("通过", `${before.passed}/${before.cases}`, `${totals.passed}/${totals.cases}`),
    row("每轮输入 tokens", b.perTurn?.tokensIn, cost.perTurn.tokensIn), row("每轮输出 tokens", b.perTurn?.output, cost.perTurn.output),
    row("每轮费用", b.perTurn?.usd, cost.perTurn.usd, money), row("有缓存一轮", b.warm?.usd, cost.warm.usd, money), row("无缓存一轮", b.cold?.usd, cost.cold.usd, money),
    row("后台费用合计", b.background, cost.background, money), "",
    ...(changed.length ? ["结果变了的场景：", ...changed.map((result) => `- ${result.id}：${was.get(result.id).pass ? "通过 → 不通过" : "不通过 → 通过"}`), ""] : ["没有场景的结果变了。", ""])];
  console.log(compareLines.join("\n"));
}
const baselineTotals = options.baseline ? summarize(results.filter((result) => result.baseline).map((result) => result.baseline)) : null;
const report = { label: options.label, suite: options.suite, at: new Date().toISOString(), model: model.model, ...totals, baseline: baselineTotals, cost, results };
const percent = (value) => `${Math.round(value * 100)}%`;
const md = [
  `# ${options.suite === "assistant" ? "日常场景测试" : "记忆测试"}：${report.label}`, "",
  `${report.at} · ${report.model} · ${report.cases} 个场景 · 通过 ${report.passed}（${percent(report.passRate)}）${baselineTotals ? ` · 无记忆基线通过 ${baselineTotals.passed}（${percent(baselineTotals.passRate)}）` : ""}`, "",
  "| 类别 | 场景 | 通过 | 要点得分 |", "|---|---|---|---|",
  ...Object.values(totals.byCategory).map((row) => `| ${row.name} | ${row.cases} | ${row.passed} | ${percent(row.points)} |`), "",
  ...compareLines, ...costLines,
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
console.log(`${report.passed}/${report.cases} passed · per turn ${cost.perTurn.tokensIn} tokens in, ${money(cost.perTurn.usd)} (warm ${money(cost.warm.usd)}, cold ${money(cost.cold.usd)}) · background ${money(cost.background)}${baselineTotals ? ` (no-memory baseline ${baselineTotals.passed}/${baselineTotals.cases})` : ""} → ${join(directory, "report.md")}`);
process.exit(0);
