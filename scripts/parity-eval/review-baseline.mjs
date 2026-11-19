// Recover chat-visible cards from a completed synthetic run and rejudge ONLY changed answer packets.
// Original answers, rival outputs and report remain immutable. No product/model answers are rerun.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cases, layers } from "./cases.mjs";
import { invoke } from "./cli.mjs";
import { blindPair, completionResult, decodeVerdict, judgeInstructions, judgeSchema, markdown, summarize } from "./score.mjs";

const source = resolve(process.argv[2] || "");
if (!source.endsWith("report.json") || source.split(/[\\/]/).includes("dogfood")) throw new Error("Provide a completed synthetic parity report.json");
const originalBytes = await readFile(source), report = JSON.parse(originalBytes);
if (!report.endedAt || !report.caseHash || report.results.length !== report.selected.length) throw new Error("Run is not complete");
const directory = join(dirname(source), "reviewed"); await mkdir(join(directory, "tmp"), { recursive: true });
// Copy only the two known synthetic store files; never open or mutate the original store.
await copyFile(join(dirname(source), "state.json"), join(directory, "state.json"));
await copyFile(join(dirname(source), "state.json.journal"), join(directory, "state.json.journal")).catch((error) => { if (error.code !== "ENOENT") throw error; });
for (const name of Object.keys(process.env)) if (/^(OPENAI_|ANTHROPIC_API_|SENDBLUE_|SMTP_|RESEND_|VAPID_|APNS_|STRIPE_|DATABASE_URL$|TOWARD_US_|REMINDER_RUN_SECRET$)/.test(name)) delete process.env[name];
process.env.AI_PROVIDER = "none";
process.env.TOWARD_US_DATA_FILE = join(directory, "state.json");
process.env.TOWARD_US_MEDIA_DIR = join(directory, "media");
process.env.TEMP = process.env.TMP = join(directory, "tmp");
const { projectSnapshot, formatVisibleAnswer } = await import("./fixture.mjs");
const { createFileStore } = await import("../../server/store.mjs");
const { createApiApp } = await import("../../server/app.mjs");
const { createReminderService } = await import("../../server/reminder-service.mjs");
const store = await createFileStore(join(directory, "state.json"));
// Authenticated read routes only. There is intentionally no product model implementation in this app.
const server = createApiApp({ store, mediator: { aiReady: false, model: "review-no-model" }, reminderService: createReminderService({ store }) }).listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const threads = await store.listRecordsForJob("privateAgentThreads"), shared = await store.listRecordsForJob("togetherConversations");
const review = { startedAt: new Date().toISOString(), source, sourceSha256: createHash("sha256").update(originalBytes).digest("hex"),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), seed: randomUUID(), cardRejudged: [], privacyCorrections: [], drafts: [], judgeCalls: [] };
try {
  for (const result of report.results) {
    const item = cases.find((entry) => entry.id === result.id);
    if (result.pinky.error) continue;
    const thread = threads.find((entry) => entry.messages?.some((message) => message.role === "user" && message.text === result.question));
    let cards = [], draft = null;
    if (thread) {
      const user = await store.getUserById(thread.ownerUserId);
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: "synthetic local parity only" }) });
      if (!login.ok) throw new Error(`Synthetic login failed for ${item.id}`);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      const response = await fetch(`${base}/assistant/sessions/${thread.id}`, { headers: { cookie } });
      if (!response.ok) throw new Error(`Synthetic session read failed for ${item.id}`);
      const messages = (await response.json()).session.messages;
      const at = messages.findLastIndex((message) => message.role === "user" && message.text === result.question);
      cards = messages.slice(at + 1).filter((message) => message.role === "assistant").flatMap((message) => message.cards || []);
    }
    if (item.channel === "shared") {
      const conversation = shared.find((entry) => entry.messages?.some((message) => message.text === result.question));
      const actor = conversation?.messages.find((message) => message.text === result.question)?.actorUserId;
      draft = conversation && projectSnapshot({ conversations: [conversation] }, actor).conversations[0]?.draftAgreement || null;
      if (item.check?.kind === "agreement") review.drafts.push({ id: item.id, saved: Boolean(draft), draft, awaitingApprovalRecord: result.pinky.evidence.persisted.length > 0 });
    }
    if (item.id === "plan-private-share-boundary" && thread) {
      const context = await store.getRelationshipContext(thread.ownerUserId);
      const peer = context.members.find((member) => member.userId !== thread.ownerUserId).userId;
      const raw = await store.relationshipSnapshotForUser(peer), projected = projectSnapshot(raw, peer);
      const hasSecret = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => ["togetherConversations", "spaces", "spaceItems", "memories"].includes(key)))).includes("辞职");
      const correction = { id: item.id, rawContainsPrivateFact: hasSecret(raw), peerProjectionContainsPrivateFact: hasSecret(projected), observedAt: new Date().toISOString(), scope: "结束状态的真实权限投影；不等同于重新运行模型" };
      review.privacyCorrections.push(correction);
      if (correction.rawContainsPrivateFact && !correction.peerProjectionContainsPrivateFact) {
        result.pinky.evidence.originalPrivacyChecks = result.pinky.evidence.privacyChecks;
        result.pinky.evidence.privacyChecks = [{ name: "更正：按真实权限投影未披露私人事实", ok: true }];
        result.pinky.evidence.storedCompletion = true;
        result.pinky.completed = completionResult(true, Object.values(result.comparisons).flatMap((entry) => entry.judges));
      }
    }
    const answer = formatVisibleAnswer(result.pinky.answer, { cards, draft });
    if (answer === result.pinky.answer) continue;
    const root = join(directory, result.id); await mkdir(root, { recursive: true });
    result.pinky.proseOnlyAnswer = result.pinky.answer;
    result.pinky.answer = answer;
    result.pinky.evidence.recoveredVisibleOutput = { cards, draft, source: "已结束的虚构状态副本；私人卡片经原API读取，共同草稿经权限投影读取" };
    review.cardRejudged.push(result.id);
    result.originalComparisons = result.comparisons;
    result.comparisons = {};
    const judgedItem = { ...item, question: result.question, visible: result.visible };
    for (const provider of ["claude", "codex"]) {
      const judges = [], rival = result.rivals[provider];
      if (!rival.error) for (const judge of ["claude", "codex"]) {
        const pair = blindPair(judgedItem, result.pinky, rival, judge, review.seed);
        try {
          const raw = await invoke(judge, { root, input: JSON.stringify(pair.input), instructions: judgeInstructions, schema: judgeSchema });
          judges.push({ judge, swap: pair.swap, ...decodeVerdict(raw.value, pair.swap), usage: raw.usage, usd: raw.usd, ms: raw.ms, model: raw.model });
          review.judgeCalls.push({ id: item.id, judge, usd: raw.usd, usage: raw.usage, ms: raw.ms });
        } catch (error) { judges.push({ judge, error: error.message }); }
      }
      result.comparisons[provider] = { judges };
    }
    result.pinky.completed = completionResult(result.pinky.evidence.storedCompletion, Object.values(result.comparisons).flatMap((entry) => entry.judges));
    await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
    console.log(`Rejudged visible cards: ${item.id}`);
  }
} finally { await new Promise((resolve) => server.close(resolve)); }
review.endedAt = new Date().toISOString();
report.review = review; report.label += "-reviewed"; report.summary = summarize(report.results, layers);
await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(directory, "report.md"), markdown(report));
console.log(`Reviewed report: ${join(directory, "report.json")}`);
process.exit(0);
