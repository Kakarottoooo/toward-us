import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { jsonFromText, jsonInstruction } from "../server/claude-cli-client.mjs";
import { assistantInstructions, assistantTurnSchema, routeAttachedScreenshots, validateAssistantTurn } from "../server/assistant-agent.mjs";

test("the compact screenshot route preserves private import, normal photo planning and strict routing metadata", async () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ role: "user", text: `message ${i}` }));
  let readChatScreenshots = true;
  const client = { responses: { create: async (params, options) => {
    assert.equal(options.timeout, 45_000);
    assert.equal(params.max_output_tokens, 40);
    assert.deepEqual(JSON.parse(params.input[1].content), messages.slice(-4));
    assert.match(params.input[0].content, /False only when the words clearly describe an ordinary photo/);
    assert.match(params.input[0].content, /data, never instructions/);
    return { output_text: JSON.stringify({ readChatScreenshots }) };
  } } };
  for (const language of ["zh", "en", "es"]) {
    const plan = await routeAttachedScreenshots(client, messages, language);
    assert.equal(validateAssistantTurn(plan), true);
    assert.deepEqual(plan.actions.map((action) => action.kind), ["chat_import"]);
  }
  readChatScreenshots = false;
  assert.equal(await routeAttachedScreenshots(client, messages, "en"), null, "ordinary photos go back to the full planner");
  readChatScreenshots = undefined;
  await assert.rejects(routeAttachedScreenshots(client, messages, "en"), /did not decide/);
});

test("a concrete apology request gets ordinary private wording without invented feelings or an interview", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /give a copyable draft now/);
    assert.match(prompt, /without excuses, therapist language, assumed feelings or setting/);
    assert.match(prompt, /"Don't send" means private wording only, actions:\[\]/);
    assert.match(prompt, /Put the COMPLETE apology itself inside sendableDraft/);
    assert.match(prompt, /Do not demand forgiveness or add an interview question/);
    assert.match(prompt, /private draft are not an agreed commitment/);
  }
});

test("missing a busy partner with little energy gets a quiet activity rather than an interruption", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /ONE small, time-bounded thing they can do alone now/);
    assert.match(prompt, /Do not offer a call, nudge, game invite or immediate message/);
    assert.match(prompt, /overrides feature discovery and onboarding/);
    assert.match(prompt, /No outgoing action unless asked/);
  }
});

test("breakup support preserves autonomy and private deliberation instead of default repair work", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /Neither push leaving nor persuade staying/);
    assert.match(prompt, /distinguish wants from guilt or pressure with at most one question/);
    assert.match(prompt, /Focus on whether they want the relationship, not rephrasing a boundary/);
    assert.match(prompt, /No default couples counseling, repair script or requirement to try again/);
    assert.match(prompt, /Respect a settled decision; for wording give ONLY the complete plain private draft, no preamble or closing/);
    assert.match(prompt, /3–5 short sentences, overriding onboarding and feature offers/);
    assert.match(prompt, /Advice\/drafting uses actions:\[\] unless asked for a sharing preview/);
    assert.match(prompt, /never suggest sharing deliberation/);
    assert.match(prompt, /Only owner-confirmed wording reaches Us, never private conversation/);
    assert.match(prompt, /Chat history remains stored; never say nothing is saved/);
    assert.match(prompt, /safety first, not mutual communication work or couples counseling/);
    assert.doesNotMatch(prompt, /breaking up, cheating/);
  }
});

test("love letters use personal private drafts and require an explicit scheduling request", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /writing or revising means private wording, actions:\[\], even with an anniversary date/);
    assert.match(prompt, /Put the COMPLETE letter in sendableDraft using only visible facts and the user's voice and length/);
    assert.match(prompt, /Omit facts with unclear actors; invent no memories, pet names or vows/);
    assert.match(prompt, /never splice catchphrases/);
    assert.match(prompt, /No preamble, feature offer, interview or scheduling question when details suffice/);
    assert.match(prompt, /If no personal detail is available, ask one relevant question/);
    assert.match(prompt, /Only an explicit request to keep it for a future day creates partner_message/);
    assert.match(prompt, /awaits writer confirmation, never already saved/);
    assert.match(prompt, /After confirmation it stays owner-only/);
  }
});

test("birthday gift advice uses visible wishes without invented prices, unsuitable DIY or outgoing actions", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /use only visible context.profile facts or this user's words/);
    assert.match(prompt, /never the partner's private space/);
    assert.match(prompt, /One idea tied to a wish and dislikes, at most one fallback, in 3–5 short sentences/);
    assert.match(prompt, /Budget is a ceiling/);
    assert.match(prompt, /without user\/lookup evidence/);
    assert.match(prompt, /drinking cup needs food-safe finishing and firing, not air-dry\/polymer clay/);
    assert.match(prompt, /gift a later experience/);
    assert.match(prompt, /Advice uses actions:\[\]/);
    assert.match(prompt, /no reminders, buying, messages, shared plans or onboarding unless requested/);
    // The Claude CLI reads the system prompt from a file (no Windows command-line limit since 11-08); keep a cap so the
    // planner prompt cannot grow without anyone noticing what each turn costs.
    const system = `${prompt}\n${jsonInstruction(assistantTurnSchema)}`;
    // 43,500 since 11-10: bounded reply grounding rules; plan metadata is added only for constrained planning.
    assert.ok(system.length < 43_500, `planner prompt is ${system.length} characters`);
  }
});

// Found by role-play testing (founder 11-07): a records search that found nothing promised results that never came, and the
// CLI model sometimes answered "the suggestions are above" instead of giving them.
const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, handoff: null, ...patch });
const action = (patch = {}) => ({ kind: "checkin", operation: "query", targetId: null, expectedVersion: null, fields: fields(), query: "妈妈", queryPeriod: "all", occurrence: null, ...patch });

async function setup(t, plan, rewriteReply, checkReplySources = async () => ({ claims: [], deliveryIssues: [] })) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "answers-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const id = randomUUID();
  await store.createUser({ id, email: `${id}@example.invalid`, name: "Ziwei", passwordHash: "test", createdAt: new Date().toISOString() });
  const mediator = { planAssistantTurn: async () => plan(), rewriteReply, checkReplySources };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const request = async (path, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = (await request("/assistant/sessions", { language: "zh", timezone: "UTC" })).session;
  return { reminders: () => createReminderService({ store }).listReminders(id), say: async (text, route = "messages") => {
    const response = await request(`/assistant/sessions/${session.id}/${route}`, { text, itemId: randomUUID() });
    assert.ok(response.session, JSON.stringify(response));
    return response.session.messages.at(-1);
  } };
}

test("a contradictory plan is repaired once before any associated write can execute", async (t) => {
  let calls = 0;
  const planConstraints = { budget: { limit: 100, currency: "CNY", limitQuote: "预算100元", items: [
    { label: "门票", upper: 80, quantity: 1, priceText: "80元", mode: "cap", sourceQuote: null },
    { label: "餐饮", upper: 40, quantity: 1, priceText: "40元", mode: "cap", sourceQuote: null },
  ] }, location: null, visits: [], food: [] };
  const { say, reminders } = await setup(t, () => { calls++; return { reply: "预算：门票80元、餐饮40元，总计100元。", planConstraints,
    actions: [action({ kind: "reminder", operation: "create", query: null, fields: fields({ title: "出行", localDateTime: "2027-05-12T20:00", timezone: "UTC", frequency: "once" }) })] }; });
  const reply = await say("帮我安排出行，预算100元，再设个提醒");
  assert.equal(calls, 2);
  assert.match(reply.text, /未通过|没通过/);
  assert.equal((await reminders()).length, 0, "even the valid reminder cannot commit alongside an invalid plan");
});

test("a reply cannot claim a memory write when this turn executed none", async (t) => {
  const { say } = await setup(t, () => ({ reply: "可以先说自己的感受。已记进「关于我们」。", actions: [] }));
  assert.equal((await say("我该怎么说？")).text, "可以先说自己的感受。");
});

test("an explicit voice transcript cannot skip the source check through planner classification", async (t) => {
  let checks = 0;
  const { say } = await setup(t, () => ({ reply: "最后说的是四点。", sourceBased: false, actions: [] }), undefined, async ({ sources }) => {
    checks++;
    assert.equal(sources[0].kind, "transcript");
    assert.match(sources[0].text, /四点/);
    return { claims: [], deliveryIssues: [] };
  });
  assert.equal((await say("语音转写：三点，改成四点。最后是几点？")).text, "最后说的是四点。");
  assert.equal(checks, 1);
});

test("an explicit single-sentence answer has no unsolicited closing", async (t) => {
  let repairs = 0;
  const { say } = await setup(t, () => ({ reply: "我也替你开心。时间不早了，早点休息。", actions: [] }), async ({ issues }) => { repairs++; assert.ok(issues.length); return "我也替你开心。"; });
  assert.equal((await say("谢谢，今天聊完好多了，只回我一句就好。")).text, "我也替你开心。");
  assert.equal((await say("谢谢，就像手机聊天那样回我一句，不要列清单。")).text, "我也替你开心。");
  assert.equal(repairs, 2);
});

test("the transcript endpoint checks the corrected source before writing exactly one reminder", async (t) => {
  let checks = 0;
  const due = `${new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}T16:00`;
  const { say, reminders } = await setup(t, () => ({ reply: "生日蛋糕按最后说的下午四点。", sourceBased: false,
    actions: [action({ kind: "reminder", operation: "create", query: null, fields: fields({ title: "买生日蛋糕", localDateTime: due, timezone: "UTC", frequency: "once" }) })],
  }), undefined, async ({ sources, checkScope }) => {
    checks++; assert.equal((await reminders()).length, 0, "check precedes the action");
    assert.deepEqual(sources, [{ kind: "transcript", text: "明天下午三点，啊不对，四点提醒我买生日蛋糕。" }]);
    assert.equal(checkScope, false);
    return { claims: [], deliveryIssues: [] };
  });
  await say("明天下午三点，啊不对，四点提醒我买生日蛋糕。", "transcripts");
  const saved = await reminders();
  assert.equal(checks, 1); assert.equal(saved.length, 1);
  assert.equal(saved[0].dueAt, `${due}:00.000Z`);
  assert.equal(saved[0].visibility, "private");
});

test("a requested draft sentence does not truncate the accompanying file analysis", async (t) => {
  const answer = "两次都是约定时间过后才告知。10月1日19:45还在工作，10月8日19:30才说来不了。可以说：计划有变化时，请在约定时间前告诉我。";
  const { say } = await setup(t, () => ({ reply: answer, actions: [] }));
  assert.equal((await say("读这个聊天记录，引用两个日期，再给我一句平和提出改进要求的话。")).text, answer);
});

test("one-sentence acknowledgement does not create an unsolicited mood card", async (t) => {
  const { say } = await setup(t, () => ({ reply: "我也替你开心。", actions: [action({ kind: "checkin", operation: "create", query: null, fields: fields({ text: "今天好多了", mood: "good" }) })] }));
  const reply = await say("今天好多了，就像手机聊天那样回我一句。");
  assert.equal(reply.text, "我也替你开心。");
  assert.deepEqual(reply.cards, []);
  assert.equal((await say("帮我记录心情：今天好多了，只回我一句。")).cards.length, 1, "an explicitly requested check-in is preserved");
});

test("a successful reminder uses its actual receipt instead of a fabricated profile claim", async (t) => {
  const { say } = await setup(t, () => ({ reply: "已记进 Sam 的档案。", actions: [action({ kind: "reminder", operation: "create", query: null, fields: fields({ title: "买花", localDateTime: "2027-05-12T20:00", timezone: "UTC", frequency: "once" }) })] }));
  const reply = await say("2027年5月12日晚上8点提醒我买花");
  assert.doesNotMatch(reply.text, /Sam|档案/);
  assert.match(reply.text, /2027-05-12 20:00/);
});

test("a records search that finds nothing says so instead of promising results", async (t) => {
  const { say } = await setup(t, () => ({ reply: "我来找找你们之前关于她妈妈来住这件事的记录，结果会直接显示给你。", actions: [action()] }));
  const reply = await say("你还记得上次我们因为她妈妈要来住的事吵架是怎么解决的吗？");
  assert.match(reply.text, /没有找到这件事的记录/);
  assert.doesNotMatch(reply.text, /结果会直接显示/);
  assert.equal((reply.cards || []).length, 0);
});

test("a search that finds something keeps Pinky's own words and shows what it found", async (t) => {
  let turn = 0;
  const { say } = await setup(t, () => (turn += 1) === 1
    ? { reply: "记下了。", actions: [action({ operation: "create", query: null, queryPeriod: "all", fields: fields({ text: "她妈妈下个月来住两周", mood: "mixed" }) })] }
    : { reply: "找到了你记过的这件事。", actions: [action()] });
  await say("她妈妈下个月来住两周，帮我记一下");
  const reply = await say("我之前说过她妈妈的事吗？");
  assert.equal(reply.text, "找到了你记过的这件事。");
  assert.equal(reply.cards.length, 1);
});

test("an empty answer is planned once more instead of showing a generic what-to-do question", async (t) => {
  let turn = 0;
  const { say } = await setup(t, () => (turn += 1) === 1 ? { reply: "", actions: [] } : { reply: "带点水果或茶叶，叫叔叔阿姨就好。", actions: [] });
  const reply = await say("见她父母第一次，带什么、说什么");
  assert.equal(turn, 2);
  assert.equal(reply.text, "带点水果或茶叶，叫叔叔阿姨就好。");
});

test("structured answers are read from the model's one JSON reply, fences and stray text tolerated", () => {
  assert.deepEqual(jsonFromText('{"reply":"建议：猫咖","actions":[]}'), { reply: "建议：猫咖", actions: [] });
  assert.deepEqual(jsonFromText('```json\n{"reply":"好","actions":[]}\n```'), { reply: "好", actions: [] });
  assert.deepEqual(jsonFromText('Here it is: {"reply":"好","actions":[]} thanks'), { reply: "好", actions: [] });
  assert.equal(jsonFromText("我给你几个建议：1. 猫咖"), null, "prose is not an answer; the caller falls back to --json-schema");
  assert.equal(jsonFromText("[1,2]"), null);
  assert.match(jsonInstruction({ type: "object" }), /exactly one JSON object/);
  assert.match(jsonInstruction({ type: "object", properties: { reply: { type: "string" } } }), /"reply"/);
});

test("advice the model wrote as prose becomes the reply itself, instead of a second call that talks about formatting", async () => {
  const { proseAsReply } = await import("../server/claude-cli-client.mjs");
  const { assistantTurnSchema } = await import("../server/assistant-agent.mjs");
  const prose = "两年异地真的不容易。\n\n先各自写下首选方案和底线，再坐下来对照。";
  assert.deepEqual(proseAsReply(prose, assistantTurnSchema), { reply: prose, sendableDraft: null, actions: [] });
  assert.deepEqual(proseAsReply(`${prose}\n<invoke name="x">\n</invoke>\n</function_calls>`, assistantTurnSchema), { reply: prose, sendableDraft: null, actions: [] });
  assert.deepEqual(proseAsReply('Example: <invoke name="x">content</invoke></function_calls>', assistantTurnSchema), { reply: 'Example: <invoke name="x">content</invoke></function_calls>', sendableDraft: null, actions: [] }, "nonempty quoted markup is preserved");
  const doubled = `${prose}\n\n<invoke name="x">\n</invoke>\n</invoke>\n\n\n<invoke name="x">\n</invoke>\n</invoke>`;
  assert.deepEqual(proseAsReply(doubled, assistantTurnSchema), { reply: prose, sendableDraft: null, actions: [] }, "use-case test 11-08: repeated empty wrappers");
  const called = `${prose}\n<invoke name="Bash">\n<parameter name="command">echo done</parameter>\n</invoke>`;
  assert.deepEqual(proseAsReply(called, assistantTurnSchema), { reply: prose, sendableDraft: null, actions: [] }, "use-case round 6: a written-out tool call with arguments");
  assert.deepEqual(proseAsReply(`${called}\n_ctx`, assistantTurnSchema), { reply: prose, sendableDraft: null, actions: [] }, "use-case round 8: stray text after the call");
  const { answerFromText } = await import("../server/claude-cli-client.mjs");
  const scraper = '可以这样写：\nheaders = {"User-Agent": "Mozilla/5.0"}\nrequests.get(url, headers=headers)';
  assert.equal(answerFromText(scraper, assistantTurnSchema)?.["User-Agent"], undefined, "use-case round 8: a JSON object from code in the prose is not the turn");
  assert.deepEqual(answerFromText('{"reply":"好","actions":[]}', assistantTurnSchema), { reply: "好", actions: [] });
  assert.equal(answerFromText("约定起草好了。", assistantTurnSchema, { allowProseReply: false }), null, "a required structured turn cannot silently lose its actions");
  assert.equal(answerFromText('{"reply":"起草好了"}', assistantTurnSchema, { allowProseReply: false }), null, "incomplete JSON also needs the strict fallback");
  assert.deepEqual(answerFromText('{"reply":"好","sendableDraft":null,"actions":[]}', assistantTurnSchema, { allowProseReply: false }), { reply: "好", sendableDraft: null, actions: [] });
  const together = { type: "object", required: ["reply", "draftAgreement", "actions", "waitingFor"], properties: { reply: { type: "string" }, draftAgreement: { anyOf: [{ type: "null" }, { type: "object" }] }, actions: { type: "array" }, waitingFor: { type: "array" } } };
  assert.deepEqual(proseAsReply("好的。", together), { reply: "好的。", draftAgreement: null, actions: [], waitingFor: [] });
  assert.equal(proseAsReply('{"reply": "broken', assistantTurnSchema), null, "half-written JSON is not prose");
  assert.equal(proseAsReply("text", { type: "object", required: ["facts"], properties: { facts: { type: "array" } } }), null, "schemas without a reply keep the strict path");
  assert.equal(proseAsReply("text", { type: "object", required: ["reply", "title"], properties: { reply: { type: "string" }, title: { type: "string" } } }), null, "nothing required may be made up");
});

test("the Claude CLI gets its system prompt from a file, so a long prompt never hits the Windows command-line limit", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../server/claude-cli-client.mjs", import.meta.url), "utf8"));
  assert.ok(!/"--system-prompt",/.test(source), "no system prompt passed as a command-line argument");
  assert.equal((source.match(/await withSystemFile\(cwd, /g) || []).length, 3, "lookup, image reading and replies all use the file");
});

test("asked for suggestions in words, Pinky gives a few specific ones, since the bulb button is gone (founder 11-09)", () => {
  for (const language of ["zh", "en", "es"]) assert.match(assistantInstructions(language), /there is no suggestions button any more/);
});

test("import help gives the chat history page as a button with labels in the member's language, never a written path (founder 11-09)", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /link action, fields\.text "\/\?view=import"/);
    assert.match(prompt, /在 Mac 上自动同步 iMessage/);
    assert.doesNotMatch(prompt, /link \/\?view=import\)/);
  }
});

test("iMessage import help offers the Windows PC route next to the Mac (founder 11-09)", () => {
  for (const language of ["zh", "en", "es"]) assert.match(assistantInstructions(language), /在 Windows 电脑上导入 iMessage/);
});

test("history answers pick the thread, give a next step, and know a past relationship from a current one (founder 11-09)", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /never end with a menu of what you could look at next/);
    assert.match(prompt, /Every pattern you name comes with one concrete thing to do/);
    assert.match(prompt, /is a past relationship/);
  }
});

test("several people: Pinky keeps each one's notes apart, compares by what the user wants with evidence, never scores (founder 11-09)", async () => {
  const { screenshotAdviceInstructions } = await import("../server/assistant-agent.mjs");
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /context\.profile\.people lists each by name/);
    assert.match(prompt, /Never score, rank by numbers or give percentages/);
    assert.match(prompt, /never help deceive one about another/);
    assert.match(screenshotAdviceInstructions(language), /Known\.people, when present/);
  }
});

test("a malformed planner answer is asked for once more before the member sees an error", async (t) => {
  // Memory eval 11-09: after a long history an old question sometimes came back as a 502.
  let turn = 0;
  const { say } = await setup(t, () => (turn += 1) === 1 ? { reply: "好的", actions: [{ kind: "no_such_kind", operation: "query" }] } : { reply: "Lin 在字节做产品经理。", actions: [] });
  const reply = await say("Lin 是做什么工作的？");
  assert.equal(turn, 2);
  assert.equal(reply.text, "Lin 在字节做产品经理。");
});
