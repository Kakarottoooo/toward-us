import { inflateRawSync } from "node:zlib";

// Turns a chat export from another app into one canonical shape (see ParsedExport in the brief): statistics run on it and an LLM reads it.
// Pure functions over bytes/strings: no I/O, no network. Formats are detected by content; the filename is only a hint.
export class ImportFormatError extends Error {
  constructor(message) { super(message); this.name = "ImportFormatError"; }
}
const fail = (message) => { throw new ImportFormatError(message); };

const MAX_MESSAGES = 400_000, MAX_CONVERSATIONS = 200;
const MAX_ZIP_ENTRY = 300 * 1024 * 1024, MAX_ZIP_TOTAL = 800 * 1024 * 1024;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------- time ----------
// Most exports carry local wall-clock times with no zone. We store them as if they were UTC: statistics only need order and gaps.
function wallIso(y, mo, d, h = 0, mi = 0, s = 0, offsetMin = 0) {
  if (y < 1970 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s), date = new Date(t);
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return new Date(t - offsetMin * 60000).toISOString();
}

function isoOk(ms) {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms), year = date.getUTCFullYear();
  return Number.isNaN(date.getTime()) || year < 1990 || year > 2100 ? null : date.toISOString();
}
const epochIso = (n) => (Number.isFinite(n) ? isoOk(n > 1e12 ? n : n * 1000) : null);

const WALL = /^(\d{1,4})([/.\-年])(\d{1,2})[/.\-月](\d{1,4})日?(?:,|\s|T)+(?:(上午|下午|午前|午後)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:([AaPp])\.?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** "12/25/23 9:41 PM", "25.12.2023 21:41", "2023-12-25T21:41:05Z", "2023年12月25日 21:41" -> ISO UTC, or null. */
export function parseWall(text, dmy = false) {
  const m = WALL.exec(String(text).trim());
  if (!m) return null;
  const [, a, , b, c, cn, hh, mm, ss, ap, tz] = m;
  let y, mo, d;
  if (a.length === 4) { y = +a; mo = +b; d = +c; }
  else {
    if (c.length !== 2 && c.length !== 4) return null;
    y = c.length === 2 ? 2000 + +c : +c;
    if (dmy) { d = +a; mo = +b; } else { mo = +a; d = +b; }
  }
  let h = +hh;
  const pm = ap ? ap.toLowerCase() === "p" : cn ? cn === "下午" || cn === "午後" : null;
  if (pm !== null) { if (h > 12) return null; if (pm && h < 12) h += 12; else if (!pm && h === 12) h = 0; }
  let offset = 0;
  if (tz && tz !== "Z") { const digits = tz.replace(":", ""); offset = (tz[0] === "-" ? -1 : 1) * (+digits.slice(1, 3) * 60 + +digits.slice(3, 5)); }
  return wallIso(y, mo, d, h, +mm, ss ? +ss : 0, offset);
}

// Day/month order is a per-file property: any first field > 12 means D/M. Dotted dates ("25.12.23") are D.M in practice when nothing else says.
function detectDmy(dateStrings) {
  let first = false, second = false, dotted = false;
  for (const s of dateStrings) {
    const m = /^(\d{1,2})([/.\-])(\d{1,2})[/.\-]\d{2,4}\b/.exec(s);
    if (!m) continue;
    if (+m[1] > 12) first = true;
    if (+m[3] > 12) second = true;
    if (m[2] === ".") dotted = true;
  }
  return first || (!second && dotted);
}

function parseTimeValue(value, dmy = false) {
  if (typeof value === "number") return epochIso(value);
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (/^\d{9,}(\.\d+)?$/.test(s)) return epochIso(+s);
  const wall = parseWall(s, dmy);
  if (wall) return wall;
  // Last resort for things like "Dec 25, 2023 9:41 PM": pin to UTC so the server's own zone never leaks in.
  return isoOk(Date.parse(/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s} UTC`));
}

// ---------- shared helpers ----------
const normText = (s) => s.replace(/[‎‏‪-‮⁦-⁩﻿]/g, "").replace(/[  ]/g, " ").replace(/\r\n?/g, "\n");
const dirname = (path) => (path.includes("/") ? path.replace(/\/[^/]*$/, "") : "");
const basename = (path) => path.replace(/\\/g, "/").split("/").pop() || "";

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  if (bytes.subarray(0, 4096).includes(0)) fail("This file is not a text chat export.");
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Meta writes UTF-8 bytes as latin1 code points; a real latin1 word like "café" fails UTF-8 decoding, so it is left alone.
function fixMojibake(s) {
  if (typeof s !== "string" || !/[\u0080-ÿ]/.test(s) || !/^[\u0000-ÿ]*$/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

function sortByTime(messages) {
  // Dated messages are sorted among themselves; undated ones keep their slots (file order).
  const slots = [];
  messages.forEach((m, i) => { if (m.at) slots.push(i); });
  const sorted = slots.map((i) => messages[i]).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  slots.forEach((slot, k) => { messages[slot] = sorted[k]; });
  return messages;
}

/** Final normalization shared by every format: drop system/empty lines, sort, derive participants, apply caps. */
function finalize(platform, conversations) {
  let out = [];
  for (const c of conversations) {
    const kept = [];
    for (const m of c.messages) {
      const sender = String(m.sender ?? "").trim();
      if (!sender) continue; // system line
      const text = String(m.text ?? "").replace(/\r\n?/g, "\n").trim(), media = Boolean(m.media);
      if (!text && !media) continue;
      kept.push({ at: m.at || null, sender, fromMe: typeof m.fromMe === "boolean" ? m.fromMe : null, text, media });
    }
    if (!kept.length) continue;
    const messages = sortByTime(kept);
    const people = new Set(messages.map((m) => m.sender));
    for (const p of c.participants || []) { const name = String(p ?? "").trim(); if (name) people.add(name); }
    const participants = [...people];
    const title = String(c.title ?? "").trim() || participants.filter((p) => p !== "Me").join(", ") || "Chat";
    out.push({ id: String(c.id), title, participants, messages });
  }
  if (!out.length) fail("No messages were found in this export.");
  if (out.length > MAX_CONVERSATIONS) out = out.sort((a, b) => b.messages.length - a.messages.length).slice(0, MAX_CONVERSATIONS);
  let total = out.reduce((n, c) => n + c.messages.length, 0);
  if (total > MAX_MESSAGES) {
    // Keep the latest messages overall: drop the oldest `total - MAX` (undated ones count as oldest).
    const all = out.flatMap((c) => c.messages).sort((a, b) => ((a.at || "") < (b.at || "") ? -1 : (a.at || "") > (b.at || "") ? 1 : 0));
    const drop = new Set(all.slice(0, total - MAX_MESSAGES));
    out = out.map((c) => ({ ...c, messages: c.messages.filter((m) => !drop.has(m)) })).filter((c) => c.messages.length);
  }
  return { platform, conversations: out };
}

// ---------- zip ----------
/** Minimal zip reader over the central directory: stored + deflate, no ZIP64. `accept(name)` skips inflating entries we do not need. */
export function readZip(bytes, { accept } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail("This is not a zip file.");
  if ((eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) || buf.readUInt16LE(eocd + 10) === 0xffff || buf.readUInt32LE(eocd + 16) === 0xffffffff) fail("ZIP64 archives are not supported.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16), total = 0;
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) fail("The zip file is damaged.");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.includes("/__MACOSX/") || usize > MAX_ZIP_ENTRY) continue;
    if (accept && !accept(name)) continue;
    if (flags & 1) fail("Password-protected zip files are not supported.");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) fail("The zip file is damaged.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) fail("The zip file is damaged.");
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      try { data = inflateRawSync(raw, { maxOutputLength: MAX_ZIP_ENTRY }); } catch { fail("The zip file is damaged."); }
    } else fail("This zip uses an unsupported compression method.");
    total += data.length;
    if (total > MAX_ZIP_TOTAL) fail("This archive is too large to import.");
    entries.push({ name, bytes: Buffer.from(data) });
  }
  return entries;
}

// ---------- iMessage attributed body ----------
/** iMessage stores text in an NSAttributedString typedstream blob when `text` is NULL; pull the plain string out of it. Never throws. */
export function decodeAttributedBody(buffer) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const marker = buf.indexOf("NSString");
    if (marker < 0) return "";
    const after = marker + 8;
    let p = -1;
    if (buf[after + 4] === 0x2b) p = after + 5; // normally 01 94 84 01 '+'
    else for (let j = after; j <= after + 8 && j < buf.length; j++) if (buf[j] === 0x2b) { p = j + 1; break; }
    if (p < 0 || p >= buf.length) return "";
    let len = buf[p++];
    // Typedstream integers: 0x81 = 16-bit, 0x82 = 32-bit, both little-endian.
    if (len === 0x81) { len = buf.readUInt16LE(p); p += 2; }
    else if (len === 0x82) { len = buf.readUInt32LE(p); p += 4; }
    else if (len > 0x82) return "";
    if (len <= 0 || p + len > buf.length) return "";
    return buf.toString("utf8", p, p + len);
  } catch { return ""; }
}

// ---------- WhatsApp ----------
const WA_DATE = String.raw`(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4})`;
const WA_TIME = String.raw`((?:上午|下午)?\s?\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)`;
const WA_IOS = new RegExp(String.raw`^\[${WA_DATE},?\s+${WA_TIME}\]\s?(.*)$`);
const WA_ANDROID = new RegExp(String.raw`^${WA_DATE},?\s+${WA_TIME}\s-\s(.*)$`);
const WA_SENDER = /^([^:]{1,60}?):(?: ([\s\S]*))?$/;
const WA_MEDIA = /^(?:<(?:Media omitted|attached:[^>]*|附件[：:][^>]*|[\w ]+ omitted)>|(?:image|video|audio|sticker|GIF|document|contact card) omitted|[^\n]*\(file attached\))$/i;

function parseWhatsApp(text, ctx) {
  const lines = text.split("\n");
  const heads = lines.map((l) => WA_IOS.exec(l) || WA_ANDROID.exec(l));
  if (!heads.some(Boolean)) return null;
  const dmy = detectDmy(heads.filter(Boolean).map((m) => m[1]));
  const messages = [];
  let cur = null;
  const flush = () => { if (cur) messages.push(cur); cur = null; };
  lines.forEach((line, i) => {
    const m = heads[i];
    if (m) {
      flush();
      const s = WA_SENDER.exec(m[3]); // no "Name:" means a system notice ("messages are encrypted", "X joined") -> dropped
      if (s) cur = { at: parseWall(`${m[1]} ${m[2]}`, dmy), sender: s[1], fromMe: null, text: s[2] ?? "" };
    } else if (cur) cur.text += `\n${line}`;
  });
  flush();
  for (const m of messages) {
    m.text = m.text.trim();
    if (WA_MEDIA.test(m.text)) { m.text = ""; m.media = true; }
  }
  if (!messages.length) return null;
  const hinted = [ctx.outer, ctx.path].map((n) => /WhatsApp Chat (?:-|with) (.+?)(?:\s\(\d+\))?(?:\.txt|\.zip)?$/i.exec(basename(n || ""))?.[1]).find(Boolean);
  return { platform: "whatsapp", conversations: [{ id: "0", title: hinted || "", messages }] };
}

// ---------- imessage-exporter (--format txt) ----------
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const IM_TS = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s?([AP]M))?(?:\s+\(.*\))?\s*$/;
const IM_ATTACHMENT = /^(?:Attachment missing!|(?:~|\/|[A-Za-z]:[\\/])[^\n]*\.[A-Za-z0-9]{2,5})$/;

function parseIMessageExporter(text) {
  const lines = text.split("\n"), starts = [];
  lines.forEach((l, i) => {
    const m = IM_TS.exec(l);
    // A block begins after a blank line (or at the top) with a timestamp and a sender line under it.
    if (m && MONTHS[m[1]] && (i === 0 || !lines[i - 1].trim()) && lines[i + 1]?.trim()) starts.push(i);
  });
  if (!starts.length) return null;
  const messages = [];
  starts.forEach((s, k) => {
    const [, mon, d, y, hh, mm, ss, ap] = IM_TS.exec(lines[s]);
    let h = +hh;
    if (ap === "PM" && h < 12) h += 12; else if (ap === "AM" && h === 12) h = 0;
    let body = lines.slice(s + 2, k + 1 < starts.length ? starts[k + 1] : lines.length);
    const reactions = body.findIndex((l) => l.trim() === "Reactions:");
    if (reactions >= 0) body = body.slice(0, reactions);
    const media = body.some((l) => IM_ATTACHMENT.test(l.trim()));
    const sender = lines[s + 1].trim(), me = sender === "Me";
    messages.push({ at: wallIso(+y, MONTHS[mon], +d, h, +mm, +ss), sender, fromMe: me, text: body.filter((l) => !IM_ATTACHMENT.test(l.trim())).join("\n"), media });
  });
  const title = [...new Set(messages.map((m) => m.sender))].filter((n) => n !== "Me").join(", ");
  return { platform: "imessage", conversations: [{ id: "0", title, messages }] };
}

// ---------- LINE (.txt) ----------
const LINE_DATES = [
  [/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*[（(]?\p{L}{0,12}[）)]?\s*$/u, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{4})年(\d{1,2})月(\d{1,2})日.*$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^[A-Za-z]{3,9},?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/, (m) => [+m[3], +m[1], +m[2]]],
];
const LINE_MSG = /^((?:上午|下午|午前|午後)?\s?\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)\t([^\t]*)\t([\s\S]*)$/;
const LINE_SYSTEM = /^(?:上午|下午|午前|午後)?\s?\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?\t[^\t]*$/;
const LINE_MEDIA = /^\[(?:Photos?|Stickers?|Videos?|Voice messages?|Audio|Files?|GIF|照片|圖片|图片|貼圖|贴图|影片|视频|語音訊息|语音消息|檔案|文件)\]$/i;
const LINE_TITLE = /^\[LINE\]\s*(?:Chat history with\s+(.+?)|與(.+?)的聊天記錄|与(.+?)的聊天记录)\s*$/;

function parseLine(text) {
  const lines = text.split("\n");
  const hasHeader = lines.slice(0, 5).some((l) => l.startsWith("[LINE]"));
  const messages = [];
  let cur = null, day = null, title = "", dateLines = 0;
  const flush = () => {
    if (!cur) return;
    let t = cur.text.trim();
    if (t.length > 1 && t.startsWith('"') && t.endsWith('"') && t.includes("\n")) t = t.slice(1, -1); // LINE quotes multi-line messages
    if (LINE_MEDIA.test(t)) { cur.media = true; t = ""; }
    cur.text = t;
    messages.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const head = LINE_TITLE.exec(line);
    if (head) { title = head[1] || head[2] || head[3]; continue; }
    const date = LINE_DATES.map(([re, pick]) => { const m = re.exec(line); return m && pick(m); }).find(Boolean);
    if (date) { flush(); day = date; dateLines++; continue; }
    const m = LINE_MSG.exec(line);
    if (m) {
      flush();
      cur = { at: day ? parseWall(`${day.join("/")} ${m[1]}`) : null, sender: m[2].trim(), fromMe: null, text: m[3] };
    } else if (LINE_SYSTEM.test(line)) flush(); // "21:41<TAB>Alex joined the chat"
    else if (cur) cur.text += `\n${line}`;
  }
  flush();
  if (!messages.length || (!hasHeader && (!dateLines || messages.length < 2))) return null;
  return { platform: "line", conversations: [{ id: "0", title, messages }] };
}

// ---------- generic pasted text ----------
const LEAD_TS = /^(?:\[([^\]]{4,40})\]|(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?))[\s\-–]*/;
const NAMED = /^([^\s:：\[\]][^:：\n]{0,29}?)(?:：|:(?=\s))\s*(.*)$/;
const WECHAT_HEAD = /^([^\s:：][^\n:：]{0,38}?)\s+((?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)$/;

const plausibleName = (name) => name.trim().split(/\s+/).length <= 4 && !/^\d+$/.test(name.trim()) && !/^https?$/i.test(name.trim());

// "Alex: hello" / "Alex：你好" lines, optionally led by a timestamp.
function parseNamedLines(text) {
  const messages = [];
  let cur = null, nonEmpty = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { if (cur) cur.text += "\n"; continue; }
    nonEmpty++;
    let rest = line, at = null;
    const ts = LEAD_TS.exec(line);
    if (ts) { at = parseWall(ts[1] || ts[2]); if (at) rest = line.slice(ts[0].length); }
    const m = NAMED.exec(rest);
    if (m && plausibleName(m[1])) { if (cur) messages.push(cur); cur = { at, sender: m[1].trim(), fromMe: null, text: m[2] }; }
    else if (cur) cur.text += `\n${line}`;
    else return null; // pasted chats start with a message, prose does not
  }
  if (cur) messages.push(cur);
  const senders = new Set(messages.map((m) => m.sender));
  if (!messages.length || senders.size > 12 || messages.length * 2 < nonEmpty) return null; // most lines must be real messages
  return messages;
}

// WeChat-style: "张三 2023-12-25 21:41" on one line, the message on the lines below.
function parseHeaderBlocks(text) {
  const messages = [];
  let cur = null, lastIso = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line ? WECHAT_HEAD.exec(line) : null;
    if (m && plausibleName(m[1])) {
      if (cur) messages.push(cur);
      let at = parseWall(m[2]);
      if (!at && lastIso && /^\d{1,2}:\d{2}/.test(m[2])) { // time only: reuse the last date, roll over midnight if the clock went backwards
        at = parseWall(`${lastIso.slice(0, 10).replace(/-/g, "/")} ${m[2]}`);
        if (at && at < lastIso) at = new Date(Date.parse(at) + 86400000).toISOString();
      }
      if (at) lastIso = at;
      cur = { at, sender: m[1].trim(), fromMe: null, text: "" };
    } else if (cur) cur.text += `\n${raw}`;
    else if (line) return null;
  }
  if (cur) messages.push(cur);
  return messages;
}

/** Specific line formats first, then the loose generic ones. `generic` marks results that must not outrank a real export in a zip. */
function parseTextFormats(rawText, ctx = {}) {
  const text = normText(rawText);
  const specific = parseWhatsApp(text, ctx) || parseIMessageExporter(text) || parseLine(text);
  if (specific) return specific;
  const named = parseNamedLines(text) || [], blocks = parseHeaderBlocks(text) || [];
  const messages = blocks.length > named.length ? blocks : named;
  if (!messages.length) return null;
  return { platform: "text", generic: true, conversations: [{ id: "0", title: "", messages }] };
}

/** Text a person pasted. Null means "no known line format": the caller then asks an LLM to read it instead. */
export function parsePastedText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const found = parseTextFormats(text);
  if (!found) return null;
  let parsed;
  try { parsed = finalize(found.platform, found.conversations); } catch { return null; }
  const messages = parsed.conversations.reduce((n, c) => n + c.messages.length, 0);
  const senders = new Set(parsed.conversations.flatMap((c) => c.participants));
  return messages >= 3 && senders.size >= 2 ? parsed : null;
}

// ---------- CSV ----------
function parseCsv(text, delimiter = ",", maxRows = Infinity) {
  const rows = [];
  let row = [], field = "", quoted = false, i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvDelimiter = (text) => {
  const first = text.slice(0, 2000).split(/\r?\n/, 1)[0];
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
};

function csvColumns(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const cols = {
    date: find(["message date", "date", "time", "timestamp", "datetime", "日期", "时间", "发送时间"]),
    sender: find(["sender name", "sender", "from", "author", "name", "发送者", "发送人"]),
    senderId: find(["sender id"]),
    text: find(["text", "message", "content", "body", "内容", "消息"]),
    direction: find(["type", "direction", "方向"]),
    conv: find(["chat session", "conversation", "chat", "会话"]),
    attachment: find(["attachment"]),
    imazing: h.includes("chat session") && h.includes("message date"),
  };
  return cols.text >= 0 && (cols.sender >= 0 || cols.direction >= 0) ? cols : null;
}

const directionOf = (v) => (/^(out|sent|outgoing|发出|发送|已发送)/i.test(v.trim()) ? true : /^(in|incoming|received|收到|接收|已接收)/i.test(v.trim()) ? false : null);

function parseCsvChat(text, ctx) {
  const delimiter = csvDelimiter(text);
  const head = parseCsv(text, delimiter, 1)[0];
  const cols = head && csvColumns(head);
  if (!cols) return null;
  const rows = parseCsv(text, delimiter).slice(1).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return null;
  const cell = (r, i) => (i >= 0 ? (r[i] ?? "") : "");
  const dmy = detectDmy(rows.map((r) => cell(r, cols.date).trim()));
  const fileTitle = basename(ctx.path || ctx.outer || "").replace(/\.\w+$/, "");
  const groups = new Map();
  for (const r of rows) {
    const conv = cell(r, cols.conv).trim(), key = conv || "0";
    if (!groups.has(key)) groups.set(key, { id: key, title: conv || fileTitle, messages: [] });
    const group = groups.get(key);
    let sender = cell(r, cols.sender).trim(), fromMe = cols.direction >= 0 ? directionOf(cell(r, cols.direction)) : null;
    if (fromMe === null && /^(me|我|self)$/i.test(sender)) fromMe = true;
    if (!sender) sender = fromMe === true ? "Me" : fromMe === false ? cell(r, cols.senderId).trim() || conv || "Them" : "";
    const attached = cell(r, cols.attachment).trim();
    group.messages.push({ at: parseTimeValue(cell(r, cols.date), dmy), sender, fromMe, text: cell(r, cols.text), media: Boolean(attached) });
  }
  return { platform: cols.imazing ? "imessage" : "csv", conversations: [...groups.values()] };
}

// ---------- Android "SMS Backup & Restore" XML ----------
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) => (s.includes("&") ? s.replace(ENTITY, (_, e) => {
  if (e[0] !== "#") return NAMED_ENTITIES[e];
  // Emoji arrive as two surrogate references (&#55357;&#56832;); decoding each alone and concatenating rebuilds the pair.
  try { return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return ""; }
}) : s);

const SMS_TAG = /<(sms|mms|part|addr|\/mms)\b/g;
const SMS_ATTR = /\s*([^\s=\/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

// Sticky attribute scanner: linear time even on tens of MB, and a ">" inside a quoted value cannot end the tag early.
function readAttrs(text, pos) {
  const attrs = {};
  let end = pos, m;
  SMS_ATTR.lastIndex = pos;
  while ((m = SMS_ATTR.exec(text))) { attrs[m[1]] = unescapeXml(m[2] ?? m[3]); end = SMS_ATTR.lastIndex; }
  const gt = text.indexOf(">", end);
  return { attrs, next: gt < 0 ? text.length : gt + 1, self: gt > 0 && text[gt - 1] === "/" };
}

function parseSmsXml(text) {
  const convs = new Map();
  const add = (address, contact, message) => {
    const key = address.replace(/[\s\-()]/g, "") || "unknown";
    if (!convs.has(key)) convs.set(key, { id: key, title: "", messages: [] });
    const conv = convs.get(key);
    if (!conv.title && contact) conv.title = contact;
    conv.messages.push(message);
  };
  const named = (v) => (v && v !== "(Unknown)" ? v : "");
  const addMms = (mms) => {
    const a = mms.attrs, address = a.address || "", group = address.includes("~");
    const sent = a.msg_box === "2", contact = group ? "" : named(a.contact_name);
    add(address || mms.from, contact, { at: epochIso(+a.date), sender: sent ? "Me" : contact || mms.from || address, fromMe: sent, text: mms.texts.join("\n"), media: mms.media });
  };
  let mms = null, m;
  SMS_TAG.lastIndex = 0;
  while ((m = SMS_TAG.exec(text))) {
    const { attrs: a, next, self } = readAttrs(text, SMS_TAG.lastIndex);
    SMS_TAG.lastIndex = next;
    const tag = m[1];
    if (tag === "sms") {
      const type = +a.type;
      if (![1, 2, 4, 5, 6].includes(type)) continue; // drafts and unknown kinds
      const sent = type !== 1, contact = named(a.contact_name), address = a.address || "";
      add(address, contact, { at: epochIso(+a.date) || parseTimeValue(a.readable_date), sender: sent ? "Me" : contact || address, fromMe: sent, text: a.body ?? "", media: false });
    } else if (tag === "mms") {
      if (mms) addMms(mms);
      mms = { attrs: a, texts: [], media: false, from: "" };
      if (self) { addMms(mms); mms = null; }
    } else if (tag === "/mms") { if (mms) addMms(mms); mms = null; }
    else if (tag === "part" && mms) {
      const ct = a.ct || "";
      if (ct === "text/plain") { if (a.text) mms.texts.push(a.text); }
      else if (ct && ct !== "application/smil") mms.media = true;
    } else if (tag === "addr" && mms && a.type === "137") mms.from = a.address || "";
  }
  if (mms) addMms(mms);
  if (!convs.size) return null;
  return { platform: "sms", conversations: [...convs.values()] };
}

// ---------- JSON ----------
function parseMeta(obj, ctx) {
  const path = `${ctx.outer || ""}/${ctx.path || ""}`;
  const instagram = /your_instagram_activity|instagram/i.test(path);
  const dir = dirname(ctx.path || "");
  const messages = obj.messages.filter(isObj).map((m) => {
    let text = fixMojibake(m.content ?? "");
    let media = Boolean(m.photos || m.videos || m.audio_files || m.files || m.gifs || m.sticker);
    if (!text && m.share) text = fixMojibake(m.share.share_text || m.share.link || "");
    if (/(?:^|\s)sent an attachment\.?$/i.test(text)) { text = ""; media = true; } // Instagram's stand-in for a missing attachment
    return { at: epochIso(+m.timestamp_ms), sender: fixMojibake(m.sender_name ?? ""), fromMe: null, text, media };
  });
  const participants = (Array.isArray(obj.participants) ? obj.participants : []).map((p) => fixMojibake(p?.name ?? ""));
  // Messages of one thread are split over message_1.json, message_2.json...; they share a folder and merge by `id`.
  const id = dir || obj.thread_path || "thread";
  return { platform: instagram ? "instagram" : "messenger", merge: true, conversations: [{ id, title: fixMojibake(obj.title ?? ""), participants, messages }] };
}

function parseTelegram(obj) {
  const chats = Array.isArray(obj.chats?.list) ? obj.chats.list : [obj];
  const me = obj.personal_information?.user_id ? `user${obj.personal_information.user_id}` : null;
  const flat = (t) => (typeof t === "string" ? t : Array.isArray(t) ? t.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("") : "");
  const conversations = [];
  chats.forEach((chat, index) => {
    if (!Array.isArray(chat?.messages)) return;
    const messages = chat.messages.filter((m) => m && m.type === "message").map((m) => ({
      at: m.date_unixtime ? epochIso(+m.date_unixtime) : parseTimeValue(m.date),
      sender: m.from ?? m.from_id ?? "",
      fromMe: me && m.from_id ? m.from_id === me : null,
      text: flat(m.text),
      media: Boolean(m.photo || m.file || m.media_type || m.sticker_emoji),
    }));
    conversations.push({ id: String(chat.id ?? index), title: chat.name || "", messages });
  });
  return { platform: "telegram", conversations };
}

const APPLE_EPOCH_MS = 978307200000;
function parsePinkyIMessage(obj) {
  const messages = [];
  for (const row of Array.isArray(obj.rows) ? obj.rows : []) {
    // Apple time is nanoseconds (modern macOS) or seconds since 2001-01-01.
    const date = Number(row.date), apple = date > 1e12 ? date / 1e6 : date * 1000;
    let text = typeof row.text === "string" ? row.text : "";
    if (!text.trim() && typeof row.body_hex === "string" && row.body_hex) text = decodeAttributedBody(Buffer.from(row.body_hex, "hex"));
    text = text.replace(/￼/g, "");
    const mine = row.is_from_me === 1 || row.is_from_me === true;
    messages.push({ at: Number.isFinite(date) && date > 0 ? isoOk(APPLE_EPOCH_MS + Math.round(apple)) : null, sender: mine ? "Me" : String(row.handle || "Them"), fromMe: mine, text, media: Number(row.attachments) > 0 && !text.trim() });
  }
  return { platform: "imessage", conversations: [{ id: "0", title: String(obj.chat?.title ?? ""), messages }] };
}

const SENDER_KEYS = ["sender_name", "senderName", "sender", "from", "author", "name", "user"];
const TEXT_KEYS = ["content", "text", "body", "message", "msg"];
const TIME_KEYS = ["timestamp_ms", "timestamp", "date", "time", "sent_at", "created_at", "timestampMs", "createdAt"];
const personName = (v) => (typeof v === "string" ? v : isObj(v) ? v.name || v.display_name || v.username || "" : "");

// Fallback for unknown JSON (incl. Messenger's encrypted-storage export): find the biggest array that looks like chat messages.
function parseJsonWalker(root) {
  let best = null, visited = 0;
  const stack = [[root, 0]];
  while (stack.length && visited++ < 5_000_000) {
    const [node, depth] = stack.pop();
    if (Array.isArray(node)) {
      const items = node.filter(isObj);
      if (items.length && items.length >= node.length * 0.6) {
        const count = (keys, ok) => keys.map((key) => [key, items.reduce((n, it) => n + (ok(it[key]) ? 1 : 0), 0)]).sort((a, b) => b[1] - a[1])[0];
        const [senderKey] = count(SENDER_KEYS, (v) => Boolean(personName(v)));
        const [textKey] = count(TEXT_KEYS, (v) => typeof v === "string" && v.length > 0);
        const score = items.filter((it) => personName(it[senderKey]) && typeof it[textKey] === "string").length;
        if (score && score >= items.length * 0.6 && (!best || score > best.score)) best = { score, items, senderKey, textKey, timeKey: (([key, n]) => (n ? key : null))(count(TIME_KEYS, (v) => v !== undefined && v !== null)) };
      }
    }
    if (depth < 10 && node && typeof node === "object") for (const child of Object.values(node)) if (child && typeof child === "object") stack.push([child, depth + 1]);
  }
  if (!best) return null;
  const meta = best.senderKey === "sender_name" || best.timeKey === "timestamp_ms";
  const fix = meta ? fixMojibake : (s) => s;
  const messages = best.items.map((it) => ({ at: parseTimeValue(it[best.timeKey]), sender: fix(personName(it[best.senderKey])), fromMe: null, text: fix(it[best.textKey] ?? ""), media: false }));
  const title = isObj(root) ? fix(String(root.title || root.name || "")) : "";
  return { platform: meta ? "messenger" : "text", generic: true, conversations: [{ id: "0", title, messages }] };
}

function parseJson(obj, ctx) {
  if (isObj(obj) && obj.format === "pinky-imessage") return parsePinkyIMessage(obj);
  if (isObj(obj) && Array.isArray(obj.chats?.list)) return parseTelegram(obj);
  if (isObj(obj) && Array.isArray(obj.messages)) {
    if (obj.messages.some((m) => m && m.type === "message" && ("from" in m || "from_id" in m))) return parseTelegram(obj);
    if (obj.messages.some((m) => m && typeof m.sender_name === "string")) return parseMeta(obj, ctx);
  }
  return parseJsonWalker(obj);
}

// ---------- entry points ----------
function parseMember(ctx) {
  const text = decodeText(ctx.bytes), head = text.slice(0, 4000);
  const lead = head.trimStart()[0];
  if (lead === "{" || lead === "[") {
    let obj;
    try { obj = JSON.parse(text); } catch { /* "[12/25/23, ..." is WhatsApp, not JSON */ }
    if (obj !== undefined) return parseJson(obj, ctx) || fail("This JSON does not look like a chat export.");
  }
  if (/<smses[\s>]/.test(head)) return parseSmsXml(text) || fail("This SMS backup has no messages.");
  return parseCsvChat(text, ctx) || parseTextFormats(text, ctx) || fail("Could not recognize this chat export.");
}

function parseZip(bytes, outer) {
  const entries = readZip(bytes, { accept: (name) => /\.(txt|json|csv|xml|html?)$/i.test(name) });
  const results = [];
  let sawHtml = false;
  for (const entry of entries) {
    if (/\.html?$/i.test(entry.name)) { sawHtml = true; continue; }
    try {
      const r = parseMember({ path: entry.name, outer, bytes: entry.bytes });
      // Thread parts merge by id; everything else stays separate per source file.
      results.push({ ...r, conversations: r.conversations.map((c) => ({ ...c, id: r.merge ? c.id : `${entry.name}#${c.id}` })) });
    } catch { /* stray files in an archive (settings, ads, likes) are expected */ }
  }
  // Loose guesses never outrank a real export found in the same archive.
  const specific = results.filter((r) => !r.generic), use = specific.length ? specific : results;
  if (!use.length) fail(sawHtml ? "This archive only has HTML files. Export again in JSON format." : "No chat history was found in this archive.");
  const merged = new Map();
  for (const conv of use.flatMap((r) => r.conversations)) {
    const have = merged.get(conv.id);
    if (!have) merged.set(conv.id, { ...conv, participants: [...(conv.participants || [])], messages: [...conv.messages] });
    else {
      have.messages.push(...conv.messages);
      have.participants.push(...(conv.participants || []));
      have.title ||= conv.title;
    }
  }
  return { platform: use[0].platform, conversations: [...merged.values()] };
}

/** Parse an uploaded export (a single file or a zip). Throws ImportFormatError when nothing recognizable is inside. */
export function parseChatExport({ name = "", bytes } = {}) {
  if (!bytes || !bytes.length) fail("The file is empty.");
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const zipped = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
  const found = zipped ? parseZip(buf, name) : parseMember({ path: name, outer: name, bytes: buf });
  return finalize(found.platform, found.conversations);
}
