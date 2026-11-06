#!/usr/bin/env node
// Read-only watch over what Pinky has said to one member. A scheduled agent reads the report, looks at the flagged
// outputs, and fixes root causes in the prompts or code. It never writes the data file and never starts the server.
//
//   node scripts/output-watch.mjs --data <store.json> --user <email> --state <state.json> [--limit 80]
//
// Privacy: the report holds only what this member can see in the app. Every record goes through the server's own
// per-user read path (store.relationshipSnapshotForUser) and projection (projectGraph -> projectRecord, which also hides
// daily-question answers until both partners have answered). The partner's private material is read only to detect a
// leak into the shared conversation; it is never printed.
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeEmail } from "../server/auth.mjs";
import { createFileStore } from "../server/store.mjs";
import { projectGraph } from "../server/relationship-domain.mjs";

const TEXT_LIMIT = 1500;
const ASKED_LIMIT = 400;
const LONG = 1200;

export async function outputWatch({ data, user: email, state = {}, limit = 80 }) {
  // The store is opened on a throwaway copy, so even a bug in a read path can never touch the real file.
  const directory = await mkdtemp(join(tmpdir(), "pinky-output-watch-"));
  try {
    const copy = join(directory, "store.json");
    await copyFile(data, copy);
    const store = await createFileStore(copy);
    const user = store.getUserByEmail(normalizeEmail(email));
    if (!user) throw new Error("No user with that email in this store.");
    const userId = user.id;
    const language = ["zh", "en", "es"].includes(user.language) ? user.language : "zh";
    const graph = projectGraph(await store.relationshipSnapshotForUser(userId), userId);
    const context = store.getRelationshipContext(userId);
    const memberIds = [userId, ...(context?.members || []).map((member) => member.userId).filter((id) => id !== userId)];
    const leaks = await privateCorpus(store, memberIds);

    const candidates = [];
    for (const conversation of graph.togetherConversations) {
      const messages = conversation.messages || [];
      const byId = new Map(messages.map((message) => [message.id, message]));
      messages.forEach((message, index) => {
        if (message.role !== "agent") return;
        const replyTo = message.replyTo && byId.get(message.replyTo);
        const asked = replyTo ? shownText(replyTo, language) : shownText([...messages.slice(0, index)].reverse().find((item) => item.role === "member") || null, language);
        candidates.push({ source: "us", ref: `${conversation.id}#${message.id}`, at: message.createdAt, kind: message.kind || "text", asked, text: shownText(message, language), shared: true });
      });
    }
    for (const thread of graph.privateAgentThreads) {
      if (thread.ownerUserId !== userId) continue;
      const messages = thread.messages || [];
      messages.forEach((message, index) => {
        if (message.role !== "assistant") return;
        const previous = messages[index - 1];
        const cards = (message.cards || []).filter((card) => card.text).map((card) => `[${card.kind} card] ${card.text}`);
        candidates.push({ source: "private", ref: `${thread.id}#${message.id}`, at: message.createdAt, kind: [thread.intentType || "assistant", message.askedFrom].filter(Boolean).join(":"), asked: previous?.role === "user" ? previous.text : null, text: [message.text, ...cards].filter(Boolean).join("\n") });
      });
    }
    for (const note of graph.notifications) {
      if (note.ownerUserId !== userId) continue;
      candidates.push({ source: "notifications", ref: note.id, at: note.createdAt, kind: note.type || "notification", asked: null, text: note.message || note.title || "" });
    }
    for (const summary of graph.summaries) candidates.push({ source: "summaries", ref: summary.id, at: summary.createdAt, kind: summary.ownerUserId === userId ? "own_summary" : "partner_summary", asked: null, text: summary.text || "", shared: summary.status === "confirmed" });
    for (const proposal of graph.proposals) candidates.push({ source: "proposals", ref: proposal.id, at: proposal.createdAt, kind: "proposal", asked: null, text: [proposal.title, proposal.rationale, proposal.tradeoffs].filter((part) => typeof part === "string" && part).join("\n"), shared: true });

    // An answer nobody just asked for should match the language the founder actually chats in, which can differ from the
    // account setting (account en, chats in Chinese): their own recent words first, else what the couple writes in Us.
    const recent = (messages) => messages.filter((message) => message.text).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-20).map((message) => message.text).join(" ");
    const usMembers = graph.togetherConversations.flatMap((conversation) => (conversation.messages || []).filter((message) => message.role === "member"));
    const ownWords = [...usMembers.filter((message) => message.actorUserId === userId), ...graph.privateAgentThreads.filter((thread) => thread.ownerUserId === userId).flatMap((thread) => (thread.messages || []).filter((message) => message.role === "user"))];
    const usual = detectLanguage(recent(ownWords)) || detectLanguage(recent(usMembers)) || language;

    const cursors = { ...(state.cursors || {}) };
    const fresh = candidates.filter((item) => item.at && (!cursors[item.source] || item.at > cursors[item.source])).sort((a, b) => a.at.localeCompare(b.at));
    const picked = fresh.slice(0, Math.max(0, limit));
    const outputs = picked.map(({ shared, ...item }) => ({
      ...item,
      asked: item.asked ? clip(item.asked, ASKED_LIMIT) : null,
      flags: flagText(item.text, { language: usual, asked: item.asked, leaks: shared ? leaks : null }),
      text: clip(item.text, TEXT_LIMIT),
    }));
    for (const item of picked) if (!cursors[item.source] || item.at > cursors[item.source]) cursors[item.source] = item.at;
    return { cursors, outputs, flagged: outputs.filter((item) => item.flags.length).length, remaining: fresh.length - picked.length, language };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** What the member actually reads: the Agent's fixed system copy has a variant per interface language. */
function shownText(message, language) {
  if (!message) return null;
  const text = message.i18n?.[language] || message.text || "";
  return text || null;
}

// --- leak detection: windows of each member's owner-only words; only a yes/no ever leaves this function ---
const CJK = /\p{Script=Han}/u;
const hanCount = (text) => (String(text).match(/\p{Script=Han}/gu) || []).length;
const normalize = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const windowSize = (text) => (CJK.test(text) ? 12 : 24);

async function privateCorpus(store, memberIds) {
  const windows = new Set();
  const add = (text) => {
    const value = normalize(text); const size = windowSize(value);
    for (let start = 0; start + size <= value.length; start += 1) windows.add(value.slice(start, start + size));
  };
  for (const memberId of memberIds) {
    const raw = await store.relationshipSnapshotForUser(memberId);
    const own = (record) => record.ownerUserId === memberId && ["private", "private_surprise"].includes(record.visibility);
    for (const thread of (raw.privateAgentThreads || []).filter(own)) for (const message of thread.messages || []) if (message.role === "user") add(message.text);
    for (const record of [...(raw.memories || []), ...(raw.checkins || [])].filter(own)) add(record.text);
    for (const conversation of raw.togetherConversations || []) for (const message of conversation.messages || []) {
      const answers = message.answers || {};
      if (Object.keys(answers).length < 2 && answers[memberId]) add(answers[memberId].text);
    }
  }
  return windows;
}

function leaksPrivate(text, windows) {
  if (!windows?.size) return false;
  const value = normalize(text); const size = windowSize(value);
  for (let start = 0; start + size <= value.length; start += 1) if (windows.has(value.slice(start, start + size))) return true;
  return false;
}

// --- flags ---
const SPANISH = /[¿¡ñ]|\b(que|para|porque|pero|también|está|tu pareja|ustedes|cómo|qué)\b/gi;
const ENGLISH = /\b(the|and|you|your|partner|with|this|that|is|are|what|for)\b/gi;

export function flagText(text, { language = "zh", asked = null, leaks = null } = {}) {
  const flags = [];
  const value = String(text || "");
  const body = value.replace(/https?:\/\/\S+/g, " ");
  if (!value.trim()) flags.push("empty");
  if (value.length > LONG) flags.push("too_long");
  if (/```|[{[]\s*"[A-Za-z_]+"\s*:|^\s*[{[][\s\S]*[}\]]\s*$/.test(body)) flags.push("raw_json");
  if (/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/.test(body) || /\b[0-9a-f]{24,}\b/i.test(body) || /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(body) || /\b[A-Z][A-Za-z]*Error\b/.test(body)) flags.push("internal_id");
  // U+FFFD replacement char, or UTF-8 bytes read as Latin-1 ("Ã©", "â€", "ï¼", "ã€").
  if (value.includes(String.fromCharCode(0xfffd)) || /Ã[©¨ª«³±¡­]|â€|ï¼|ã€/.test(value)) flags.push("mojibake");
  if (/\b(?:pick|choose|select|reply(?: with)?|type)\s+(?:option\s+)?[1-3A-C]\b/i.test(body) || /(?:选|选择|回复|输入)\s*[1-3１-３A-Ca-c](?![\d\p{L}])/u.test(body) || /\b(?:elige|escoge|responde)\s+(?:la opción\s+)?[1-3A-C]\b/i.test(body)) flags.push("choice_menu");
  if (/not connected|isn't connected|can(?:no|')t access|do(?:n't| not) have access|unable to access|no access to|无法访问|没有权限|未连接|没有连接|无法连接|不能访问|看不到你的|no tengo acceso|no puedo acceder|no está conectad/i.test(body)) flags.push("claims_not_connected");
  if (/you(?:'ll| will)? need to (?:manually|do it yourself|open|go to)|please (?:manually|do it yourself)|you can do it yourself|do it manually|你需要自己|你得自己|请你手动|你可以自己去|手动(?:添加|设置|创建|操作)|tendrás que hacerlo|hazlo tú mism|manualmente/i.test(body)) flags.push("asks_manual_work");
  // Pinky answers in the language the person just wrote in; the account language is the fallback.
  if (value.trim() && wrongLanguage(body, detectLanguage(asked) || language)) flags.push("wrong_language");
  if (genderedGuess(body)) flags.push("gendered_guess");
  if (leaks && leaksPrivate(value, leaks)) flags.push("private_leak");
  return flags;
}

function detectLanguage(text) {
  const value = String(text || "");
  if (hanCount(value) >= 2) return "zh";
  const spanish = (value.match(SPANISH) || []).length; const english = (value.match(ENGLISH) || []).length;
  if (spanish >= 2 && spanish > english) return "es";
  if (english >= 2 && english > spanish) return "en";
  return null;
}

function wrongLanguage(text, language) {
  const cjk = hanCount(text);
  const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
  if (language === "zh") return cjk === 0 && latin >= 20;
  if (cjk >= 4) return true;
  const spanish = (text.match(SPANISH) || []).length; const english = (text.match(ENGLISH) || []).length;
  if (language === "en") return spanish >= 3 && spanish > english;
  return english >= 3 && english > spanish;
}

/** Product rule (server prompts): never guess anyone's gender: name or TA, no he/she, never 他/她. */
function genderedGuess(text) {
  if (/[他她]/.test(text.replace(/其他|他人|他们|吉他|其它/g, ""))) return true;
  if (/\b(?:he|she|him|her|hers|his|himself|herself)\b/i.test(text)) return true;
  return /(?:^|[^\p{L}])(?:él|ella|ellas)(?![\p{L}])/iu.test(text);
}

const clip = (text, size) => (String(text).length > size ? `${String(text).slice(0, size)}…` : String(text));

// --- CLI ---
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function readState(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data || !args.user || !args.state) {
    console.error("Usage: node scripts/output-watch.mjs --data <store.json> --user <email> --state <state.json> [--limit 80]");
    process.exit(2);
  }
  const state = await readState(args.state);
  const report = await outputWatch({ data: args.data, user: args.user, state, limit: Number(args.limit) || 80 });
  // Cursors move only once the report is out, so a crash mid-print re-reports instead of skipping.
  await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (error) => (error ? reject(error) : resolve())));
  await writeFile(`${args.state}.tmp`, JSON.stringify({ cursors: report.cursors, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await rename(`${args.state}.tmp`, args.state);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(`output-watch failed: ${error?.message || error}`); process.exit(1); });
}
