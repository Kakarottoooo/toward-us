// Promise-extraction eval: runs the real "还欠着什么" scan (scanTogether / scanPrivate, with its prompt, schema, quote
// check and de-duplication) over invented couple chats and scores what the app keeps against hand-written answers.
// Local only, and only through the founder's Claude CLI: one model call per fixture, no API keys.
//   npm run eval:promises -- [--label before] [--only id1,id2] [--concurrency 4]
// Writes work/promise-eval/<label>-<time>/report.{json,md}. Keep runs few: every run spends one call per fixture.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "claude-cli") throw new Error("eval:promises runs only with AI_PROVIDER=claude-cli.");
process.env.AI_PROVIDER = "claude-cli";
// Never an API key, whatever the shell holds.
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[name];

const { createApiApp } = await import("../server/app.mjs");
const { createFileStore } = await import("../server/store.mjs");
const { createMediator } = await import("../server/mediator.mjs");
const { createRelationshipRecord } = await import("../server/relationship-domain.mjs");
const { appendTogetherMessage } = await import("../server/together-domain.mjs");
const { scanPrivate, scanTogether } = await import("../server/promises.mjs");
const { loadFixtures, scoreRun, validateFixtures } = await import("./promise-eval/score.mjs");

const { values: options } = parseArgs({ options: { label: { type: "string", default: "run" }, only: { type: "string" }, concurrency: { type: "string", default: "4" } } });
const data = loadFixtures();
const problems = validateFixtures(data);
if (problems.length) throw new Error(`fixtures.json is not well-formed:\n${problems.join("\n")}`);
const wanted = options.only ? new Set(options.only.split(",")) : null;
const fixtures = data.fixtures.filter((fixture) => !wanted || wanted.has(fixture.id));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(process.cwd(), "work", "promise-eval", `${options.label}-${stamp}`);
await mkdir(directory, { recursive: true });
const store = await createFileStore(join(directory, "state.json"));
// The App's own mediator has no model, so nothing in the background spends calls; the scan below is driven directly.
const server = createApiApp({ store, mediator: { aiReady: false, model: "eval" } }).listen(Number(process.env.PORT || 5194), "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${server.address().port}`;

const model = createMediator({ apiKey: "" });
let calls = 0;

async function post(path, body, cookie) {
  const response = await fetch(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function couple(fixture, index) {
  const register = async (role) => {
    const { result, cookie } = await post("/auth/register", { name: fixture.names[role], email: `eval-${index}-${role.toLowerCase()}@example.test`, password: "eval only, local test store" });
    return { user: result.user, cookie };
  };
  const a = await register("A"), b = await register("B");
  const invitation = await post("/partner/invitations", {}, a.cookie);
  await post("/partner/accept", { code: invitation.result.pairing.invitation.code }, b.cookie);
  const context = await store.getRelationshipContext(a.user.id);
  if (context.members.find((member) => member.userId === a.user.id)?.role !== "A") throw new Error("expected the inviter to be A");
  return { a, b, relationshipId: context.relationship.id };
}

async function runFixture(fixture, index) {
  const { a, b, relationshipId } = await couple(fixture, index);
  const ids = [];
  let scan;
  if (fixture.channel === "together") {
    for (const message of fixture.messages) {
      const actor = message.from === "A" ? a.user.id : message.from === "B" ? b.user.id : null;
      const { message: saved } = await store.transaction(`relationship:${relationshipId}`, (tx) => appendTogetherMessage(tx, { relationshipId, actorUserId: actor, userId: a.user.id, source: "app", text: message.text }));
      ids.push(saved.id);
    }
    scan = (mediator) => scanTogether({ store, mediator, relationshipId, userId: a.user.id });
  } else {
    const createdAt = new Date().toISOString();
    const messages = fixture.messages.map((message, line) => ({ id: `m${line}`, role: message.from === "A" ? "user" : "assistant", text: message.text, createdAt }));
    const session = createRelationshipRecord({ relationshipId: null, userId: a.user.id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "UTC", messages });
    await store.createRelationshipRecord("privateAgentThreads", session);
    ids.push(...messages.map((message) => message.id));
    scan = (mediator) => scanPrivate({ store, mediator, userId: a.user.id, sessionId: session.id });
  }
  let raw = [];
  const counted = { structured: async (request) => { calls += 1; const answer = await model.structured(request); raw = Array.isArray(answer?.promises) ? answer.promises : []; return answer; } };
  const started = Date.now();
  try {
    const created = await scan(counted);
    const byRole = { member_a: "A", member_b: "B", both: "both" };
    const predictions = created.map((record) => ({ line: ids.indexOf(record.evidence?.messageId), by: byRole[record.ownerType] || record.ownerType, what: record.description, when: record.whenText || "", quote: record.evidence?.quote || "" }));
    return { fixture, predictions, raw: raw.map((item) => ({ ...item, line: ids.indexOf(item.messageId) })), ms: Date.now() - started };
  } catch (error) {
    return { fixture, predictions: [], raw, error: String(error?.message || error).slice(0, 300), ms: Date.now() - started };
  }
}

const runs = new Array(fixtures.length);
let next = 0;
const worker = async () => { while (next < fixtures.length) { const index = next++; runs[index] = await runFixture(fixtures[index], index); process.stdout.write(`${runs[index].error ? "x" : "."}`); } };
try {
  await Promise.all(Array.from({ length: Math.max(1, Number(options.concurrency) || 1) }, worker));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(join(directory, "state.json"), { force: true });
}
process.stdout.write("\n");

const report = { label: options.label, at: new Date().toISOString(), model: model.model, modelCalls: calls, fixtureCount: fixtures.length, ...scoreRun(runs), runs: runs.map(({ fixture, predictions, raw, error, ms }) => ({ id: fixture.id, predictions, raw, error, ms })) };
const percent = (value) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const { totals } = report;
const md = [
  `# Promise extraction eval: ${report.label}`, "",
  `${report.at} · ${report.model} · ${report.fixtureCount} fixtures · ${report.modelCalls} model calls`, "",
  `| precision | recall | F1 | by | what | when | TP | FP | FN | optional hits | dropped before keeping |`,
  `|---|---|---|---|---|---|---|---|---|---|---|`,
  `| ${percent(totals.precision)} | ${percent(totals.recall)} | ${percent(totals.f1)} | ${percent(totals.fields.by)} | ${percent(totals.fields.what)} | ${percent(totals.fields.when)} | ${totals.tp} | ${totals.fp} | ${totals.fn} | ${totals.optionalHits} | ${totals.droppedBeforeKeeping} |`, "",
  "## Errors", "", ...Object.entries(report.errors).map(([name, count]) => `- ${name}: ${count}`), "",
  "## Per fixture", "",
  ...report.fixtures.flatMap((item) => {
    const run = report.runs.find((entry) => entry.id === item.id);
    const fixture = fixtures.find((entry) => entry.id === item.id);
    const wrong = item.results.filter((result) => result.outcome === "true_positive" && Object.values(result.fields).includes(false));
    if (!item.fp && !item.fn && !wrong.length && !item.error) return [`- ${item.id}: ok (${item.tp} found${item.optionalHits ? `, ${item.optionalHits} optional` : ""})`];
    return [`- ${item.id}: TP ${item.tp}, FP ${item.fp}, FN ${item.fn}${item.error ? `, error: ${item.error}` : ""}`,
      ...item.results.filter((result) => result.outcome === "false_positive").map((result) => `  - ${result.error}: line ${result.prediction.line} by ${result.prediction.by}: "${result.prediction.what}" (${result.prediction.when || "no time"})`),
      ...wrong.map((result) => `  - wrong ${Object.entries(result.fields).filter(([, right]) => !right).map(([field]) => field).join("+")}: by ${result.prediction.by}, "${result.prediction.what}", when "${result.prediction.when}" (expected by ${fixture.expected[result.expected].by}, when ${JSON.stringify(fixture.expected[result.expected].when)})`),
      ...item.misses.map((miss) => `  - ${miss.error}: line ${JSON.stringify(fixture.expected[miss.expected].line)} by ${fixture.expected[miss.expected].by} (${fixture.expected[miss.expected].what.join(", ")})`),
      ...(run.raw.length !== run.predictions.length ? [`  - model said ${run.raw.length}, app kept ${run.predictions.length}: ${JSON.stringify(run.raw.map((entry) => ({ line: entry.line, by: entry.by, quote: entry.quote })))}`] : [])];
  }),
].join("\n");
await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(directory, "report.md"), `${md}\n`);
console.log(md.split("\n").slice(0, 7).join("\n"));
console.log(`\nErrors: ${JSON.stringify(report.errors)}\nReport: ${join(directory, "report.md")}`);
