// Memory at scale (founder 11-09: "同意压测规模"): fills a fresh local account with years of use the way the App keeps it
// (conversations paged, notes over every person, portraits), then times what one ordinary turn costs and measures what is
// sent to the model, with a stand-in model that only records its inputs. Local only, never the dogfood server.
//   node scripts/scale-memory.mjs [--years 3] [--per-day 30] [--label x]
// Writes work/memory-scale/<label>-<time>.json and prints a table.
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values: options } = parseArgs({ options: { years: { type: "string", default: "3" }, "per-day": { type: "string", default: "30" }, label: { type: "string", default: "run" } } });
const YEARS = Number(options.years), PER_DAY = Number(options["per-day"]), DAYS = Math.round(YEARS * 365), DAY = 86400000;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(process.cwd(), "work", "memory-scale", `${options.label}-${stamp}`);
await mkdir(directory, { recursive: true });
process.env.TOWARD_US_MEDIA_DIR = join(directory, "media");

const { createApiApp } = await import("../server/app.mjs");
const { createFileStore } = await import("../server/store.mjs");
const { createRelationshipRecord } = await import("../server/relationship-domain.mjs");
const { personFor, personSubject } = await import("../server/people.mjs");
const { LIMIT, KEEP } = await import("../server/thread-pages.mjs");
const { searchMemory } = await import("../server/memory-search.mjs");
const { tidyMemory } = await import("../server/memory-tidy.mjs");
const { refreshPortraits } = await import("../server/portraits.mjs");

// The stand-in model: answers instantly and records how big each request was.
const calls = [];
let lastContext = null;
const record = (name, input) => { const size = typeof input === "string" ? input.length : JSON.stringify(input).length; calls.push({ name, chars: size }); };
const mediator = {
  aiReady: true, model: "scale-stand-in",
  async planAssistantTurn(context) { record("planAssistantTurn", context); lastContext = context; return { reply: "好的，我记下了。", actions: [] }; },
  async structured({ name, input }) {
    record(name, input);
    if (name === "portrait") return { portrait: "测试画像".repeat(50), timeline: [] };
    if (name === "memory_tidy") return { merges: [], outdated: [] };
    if (name === "conversation_summary") return { summary: "摘要".repeat(300) };
    return {};
  },
};
for (const method of ["respond", "complete", "chat"]) mediator[method] = async (input) => { record(method, input); return {}; };

const storePath = join(directory, "state.json");
const store = await createFileStore(storePath);
const server = createApiApp({ store, mediator }).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function call(path, body, cookie, method = body ? "POST" : "GET") {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  return { body: JSON.parse(text || "{}"), bytes: text.length, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const time = async (fn) => { const started = performance.now(); const value = await fn(); return { ms: Math.round(performance.now() - started), value }; };

const { body: registered, cookie } = await call("/auth/register", { name: "压测", email: `scale-${randomUUID().slice(0, 8)}@example.test`, password: "scale test only, local store" });
const userId = registered.user.id;

// ---- Fill: years of use, written directly the way the App would have left it. ----
const LIVE = ["阿杰", "Lily", "小雨", "Mia", "晴晴"], PAST = Array.from({ length: 15 }, (_, index) => `以前的人${index + 1}`);
const people = {};
for (const name of [...LIVE, ...PAST]) people[name] = await store.transaction(`user:${userId}`, (tx) => personFor(tx, userId, name));
const LINES = ["今天上班好累，开了一下午会", "周末去公园散步了，天气不错", "他今天回消息有点慢，我是不是想多了", "我们约了周六一起吃火锅", "最近在追一部剧，挺好看的", "跟妈妈打了个电话，聊了很久", "感觉这段关系有点卡住了，不知道怎么推进", "他说下次带我去看海"];
const now = Date.now(), start = now - DAYS * DAY;
const message = (index, at, role) => ({ id: randomUUID(), role, text: role === "user" ? `${LINES[index % LINES.length]}（第 ${index} 条）` : `嗯，我听到了。你可以试着直接问问他的想法，说说你的感受。（第 ${index} 条）`, createdAt: new Date(at).toISOString() });
/** One conversation as paging leaves it: newest KEEP on the record, the rest in pages of LIMIT-KEEP, all summarised. */
function conversation(count, personId = null) {
  const all = Array.from({ length: count }, (_, index) => message(index, start + (index / count) * (now - start), index % 2 ? "assistant" : "user"));
  const keep = all.length > LIMIT ? all.slice(-KEEP) : all, older = all.slice(0, all.length - keep.length), earlier = [];
  for (let index = 0; index < older.length; index += LIMIT - KEEP) { const page = older.slice(index, index + LIMIT - KEEP); earlier.push({ from: page[0].createdAt, to: page.at(-1).createdAt, messages: page }); }
  return createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", intentType: "assistant", language: "zh", timezone: "Asia/Shanghai", messages: keep, earlier, earlierSummary: "之前聊过：".padEnd(1200, "事"), summarizedPages: earlier.length, ...(personId ? { personId } : {}), createdAt: all[0]?.createdAt, updatedAt: all.at(-1)?.createdAt });
}
const total = DAYS * PER_DAY, mainShare = Math.round(total * 0.6), personShare = Math.round((total - mainShare) / LIVE.length);
const threads = { main: conversation(mainShare) };
for (const name of LIVE) threads[name] = conversation(personShare, people[name].id);
const notes = [];
// Most notes are about the member and the person they talk about most; a few about everyone else.
const weighted = [[userId, 8], [personSubject(people[LIVE[0]].id), 5], ...LIVE.slice(1).map((name) => [personSubject(people[name].id), 1]), ...PAST.map((name) => [personSubject(people[name].id), 0.2])];
const bag = weighted.flatMap(([subject, weight]) => Array(Math.round(weight * 5)).fill(subject));
const subjects = bag;
const KINDS = ["likes", "dislikes", "values", "family", "work", "history", "food", "other"];
for (let day = 0; day < DAYS; day += 1) for (let n = 0; n < 2; n += 1) {
  const at = new Date(start + day * DAY + n * 3600000).toISOString(), subject = subjects[(day * 2 + n) % subjects.length], category = KINDS[(day + n) % KINDS.length];
  notes.push(createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: subject, category, text: `${category === "history" ? `${at.slice(0, 10)} ` : ""}第 ${day} 天记下的一件事：${LINES[(day + n) % LINES.length]}`, evidence: { channel: "private", saidAt: at }, createdAt: at, updatedAt: at }));
}
const filled = await time(() => store.transaction(`user:${userId}`, async (tx) => {
  for (const thread of Object.values(threads)) await tx.createRelationshipRecord("privateAgentThreads", thread);
  for (const note of notes) await tx.createRelationshipRecord("memories", note);
}));
const messages = Object.values(threads).reduce((sum, thread) => sum + thread.messages.length + thread.earlier.reduce((pages, page) => pages + page.messages.length, 0), 0);
console.log(`filled ${YEARS} years: ${messages} messages, ${notes.length} notes, ${LIVE.length + PAST.length} people in ${filled.ms} ms; store ${((await stat(storePath)).size / 1e6).toFixed(1)} MB`);

// Portraits exist after years of use; build them once so turns read them like the App would.
await refreshPortraits({ store, mediator, userId });
calls.length = 0;

// ---- Measure. ----
const results = { years: YEARS, perDay: PER_DAY, messages, notes: notes.length, storeMB: Number(((await stat(storePath)).size / 1e6).toFixed(2)), steps: [] };
const step = async (name, fn, repeat = 3) => {
  const times = [];
  let value;
  for (let index = 0; index < repeat; index += 1) { const before = calls.length; const run = await time(fn); times.push(run.ms); value = { ...run.value, calls: calls.slice(before) }; }
  const row = { name, ms: Math.round(times.reduce((a, b) => a + b, 0) / times.length), max: Math.max(...times), bytes: value?.bytes, model: (value?.calls || []).map((entry) => `${entry.name} ${(entry.chars / 1000).toFixed(1)}k`).join(", ") };
  results.steps.push(row); console.log(`${name.padEnd(36)} ${String(row.ms).padStart(6)} ms (max ${row.max})${row.bytes ? `  response ${(row.bytes / 1000).toFixed(0)} kB` : ""}${row.model ? `  → ${row.model}` : ""}`);
  return value;
};
const mainId = threads.main.id;
const jie = (await call("/assistant/sessions", { language: "zh", timezone: "Asia/Shanghai", personId: people["阿杰"].id }, cookie)).body.session.id;
await step("open main conversation", () => call("/assistant/sessions", { language: "zh", timezone: "Asia/Shanghai" }, cookie));
await step("load latest conversation", () => call("/assistant/sessions/latest", null, cookie));
await step("one turn, main (Pinky brain)", () => call(`/assistant/sessions/${mainId}/messages`, { text: "我最近和阿杰有点别扭，你怎么看？", itemId: randomUUID() }, cookie));
const sizes = (context) => Object.entries(context || {}).map(([key, value]) => [key, JSON.stringify(value ?? null).length]).sort((a, b) => b[1] - a[1]);
results.mainContext = sizes(lastContext); console.log("  main context by part:", results.mainContext.slice(0, 10).map(([key, size]) => `${key} ${(size / 1000).toFixed(1)}k`).join(", "));
if (lastContext?.profile) { results.profileParts = sizes(lastContext.profile); console.log("  profile by part:", results.profileParts.slice(0, 8).map(([key, size]) => `${key} ${(size / 1000).toFixed(1)}k`).join(", ")); }
await step("one turn, 阿杰's conversation", () => call(`/assistant/sessions/${jie}/messages`, { text: "他今天又没回我消息", itemId: randomUUID() }, cookie));
results.personContext = sizes(lastContext); console.log("  阿杰 context by part:", results.personContext.slice(0, 8).map(([key, size]) => `${key} ${(size / 1000).toFixed(1)}k`).join(", "));
await step("older messages, page 1", () => call(`/assistant/sessions/${mainId}/earlier?page=0`, null, cookie).catch((error) => ({ error: String(error) })));
await step("people list", () => call("/people", null, cookie));
await step("one person's page", () => call(`/people/${people["阿杰"].id}`, null, cookie));
await step("memory list (关于我们)", () => call("/memories", null, cookie));
await step("memory search, words", async () => { const found = await searchMemory({ store, userId, query: "看海 火锅" }); return { bytes: found.length }; });
await step("memory search, a day", async () => { const found = await searchMemory({ store, userId, date: new Date(now - 400 * DAY).toISOString().slice(0, 10) }); return { bytes: found.length }; });
await step("store write (one small change)", () => store.transaction(`user:${userId}`, (tx) => tx.updateRelationshipRecordForUser("memories", notes[0].id, userId, (draft) => { draft.version += 1; })));
await step("background tidy (all subjects)", async () => ({ tidied: await tidyMemory({ store, mediator, userId, force: true }) }), 1);
await step("portraits (all due)", async () => { await store.transaction(`user:${userId}`, async (tx) => { for (const item of (await tx.listRelationshipRecordsForUser("memories", userId)).filter((entry) => entry.kind === "portrait")) await tx.updateRelationshipRecordForUser("memories", item.id, userId, (draft) => { draft.basis = "stale"; draft.builtAt = "2000-01-01T00:00:00Z"; draft.version += 1; }); }); return { built: (await refreshPortraits({ store, mediator, userId })).length }; }, 1);

await writeFile(join(directory, "..", `${options.label}-${stamp}.json`), JSON.stringify(results, null, 2));
server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
await rm(directory, { recursive: true, force: true });
process.exit(0);
