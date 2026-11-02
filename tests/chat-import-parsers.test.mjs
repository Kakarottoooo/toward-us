import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { ImportFormatError, decodeAttributedBody, parseChatExport, parsePastedText, readZip } from "../server/chat-import-parsers.mjs";

const parse = (name, text) => parseChatExport({ name, bytes: Buffer.from(text, "utf8") });
const only = (parsed) => { assert.equal(parsed.conversations.length, 1); return parsed.conversations[0]; };

// A tiny zip writer: stored or deflated entries, central directory at the end.
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameBytes = Buffer.from(name), raw = Buffer.from(data), body = deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("WhatsApp iOS: LRM and narrow no-break space are stripped, continuations join, system lines and media are handled", () => {
  const text = [
    "‎[12/25/23, 9:41:05 PM] Alex: hello",
    "[12/25/23, 9:42:00 PM] Sam: line one",
    "second line",
    "",
    "[12/25/23, 9:43:10 PM] Alex: ‎<attached: 00000001-PHOTO.jpg>",
    "[12/25/23, 9:44:00 PM] Messages and calls are end-to-end encrypted.",
    "[12/25/23, 9:45:00 AM] Sam: ‎image omitted",
  ].join("\n");
  const conv = only(parse("chat.txt", text));
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.text, m.media]), [
    ["Sam", "", true], ["Alex", "hello", false], ["Sam", "line one\nsecond line", false], ["Alex", "", true],
  ]);
  assert.equal(conv.messages[0].at, "2023-12-25T09:45:00.000Z"); // 9:45 AM sorts before the PM messages
  assert.equal(conv.messages[1].at, "2023-12-25T21:41:05.000Z");
  assert.deepEqual(conv.participants, ["Sam", "Alex"]);
});

test("WhatsApp Android: 24h D/M order is detected and the title comes from the file name", () => {
  const text = "25/12/2023, 21:41 - Alex: hi\n02/01/2024, 08:05 - Sam: hello\n";
  const parsed = parse("WhatsApp Chat with Alex.txt", text);
  assert.equal(parsed.platform, "whatsapp");
  const conv = only(parsed);
  assert.equal(conv.title, "Alex");
  assert.deepEqual(conv.messages.map((m) => m.at), ["2023-12-25T21:41:00.000Z", "2024-01-02T08:05:00.000Z"]);
  assert.equal(only(parse("x.txt", "12/25/23, 9:41 PM - Alex: hey\n12/26/23, 9:41 AM - Sam: yo")).messages[0].at, "2023-12-25T21:41:00.000Z");
  assert.equal(only(parse("x.txt", "2023/12/25 21:41 - Alex: a\n2023-12-26 07:00 - Sam: b")).messages[1].at, "2023-12-26T07:00:00.000Z");
  assert.equal(only(parse("x.txt", "25.12.23, 21:41 - Alex: a\n26.12.23, 07:00 - Sam: b")).messages[0].at, "2023-12-25T21:41:00.000Z");
});

test("WhatsApp export inside a zip: stored and deflated members, media ignored, title from the zip name", () => {
  const chat = "12/25/23, 9:41 PM - Alex: hello\n12/25/23, 9:42 PM - Sam: <Media omitted>\n";
  for (const deflate of [false, true]) {
    const zip = makeZip([{ name: "__MACOSX/._x", data: "junk" }, { name: "IMG-0001.jpg", data: Buffer.from([0xff, 0xd8, 0, 1]) }, { name: "_chat.txt", data: chat, deflate }]);
    const parsed = parseChatExport({ name: "WhatsApp Chat - Alex (1).zip", bytes: zip });
    assert.equal(parsed.platform, "whatsapp");
    const conv = only(parsed);
    assert.equal(conv.title, "Alex");
    assert.deepEqual(conv.messages.map((m) => [m.sender, m.text, m.media]), [["Alex", "hello", false], ["Sam", "", true]]);
  }
  assert.deepEqual(readZip(makeZip([{ name: "a.txt", data: "x", deflate: true }, { name: "dir/", data: "" }])).map((e) => [e.name, e.bytes.toString()]), [["a.txt", "x"]]);
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely")), ImportFormatError);
});

test("Messenger JSON: mojibake is repaired, newest-first is sorted, message_N.json parts merge, Instagram is told apart", () => {
  const moji = (s) => Buffer.from(s, "utf8").toString("latin1");
  const part = (messages) => JSON.stringify({ participants: [{ name: "Ana" }, { name: moji("Zoë") }], title: moji("Zoë"), messages });
  const a = part([
    { sender_name: "Ana", timestamp_ms: 1700000300000, content: moji("你好") },
    { sender_name: moji("Zoë"), timestamp_ms: 1700000200000, content: moji("café") },
  ]);
  const b = part([
    { sender_name: "Ana", timestamp_ms: 1700000100000, content: "first", photos: [{ uri: "x.jpg" }] },
    { sender_name: "Ana", timestamp_ms: 1700000050000, content: "Ã©" },
  ]);
  const messenger = parseChatExport({ name: "facebook.zip", bytes: makeZip([
    { name: "messages/inbox/zoe_123/message_1.json", data: a, deflate: true },
    { name: "messages/inbox/zoe_123/message_2.json", data: b },
    { name: "messages/autofill_information.json", data: JSON.stringify({ phone: [{ name: "x" }] }) },
  ]) });
  assert.equal(messenger.platform, "messenger");
  const conv = only(messenger);
  assert.equal(conv.title, "Zoë");
  assert.deepEqual(conv.messages.map((m) => m.text), ["é", "first", "café", "你好"]);
  assert.equal(conv.messages[1].media, true);
  assert.deepEqual(conv.participants, ["Ana", "Zoë"]);
  const instagram = parseChatExport({ name: "i.zip", bytes: makeZip([{ name: "your_instagram_activity/messages/inbox/zoe_1/message_1.json", data: a }]) });
  assert.equal(instagram.platform, "instagram");
  assert.equal(parse("message_1.json", moji("{\"messages\":[{\"sender_name\":\"A\",\"content\":\"x\"}]}")).platform, "messenger");
});

test("Telegram: single chat and full export, text parts array, service messages skipped", () => {
  const messages = [
    { type: "service", date: "2023-01-01T11:00:00", actor: "Ana", action: "create_group" },
    { type: "message", date: "2023-01-01T12:00:00", date_unixtime: "1672574400", from: "Ana", text: ["see ", { type: "link", text: "https://x.io" }, " ok"] },
    { type: "message", date: "2023-01-01T12:01:00", from: "Bo", text: "hey", photo: "photos/a.jpg" },
  ];
  const single = parse("result.json", JSON.stringify({ name: "Bo", type: "personal_chat", id: 7, messages }));
  assert.equal(single.platform, "telegram");
  const conv = only(single);
  assert.equal(conv.title, "Bo");
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.text, m.media, m.at]), [
    ["Ana", "see https://x.io ok", false, "2023-01-01T12:00:00.000Z"], ["Bo", "hey", true, "2023-01-01T12:01:00.000Z"],
  ]);
  const full = parse("result.json", JSON.stringify({ personal_information: { user_id: 1 }, chats: { list: [{ name: "A", id: 1, messages }, { name: "B", id: 2, messages: [{ type: "message", date: "2023-02-01T00:00:00", from: "Z", from_id: "user1", text: "me" }] }] } }));
  assert.equal(full.conversations.length, 2);
  assert.equal(full.conversations[1].messages[0].fromMe, true);
});

test("imessage-exporter text: Me is fromMe, parenthetical suffixes and attachments are handled", () => {
  const text = [
    "Jan 01, 2023  9:41:05 PM", "Me", "Hello there", "second line", "",
    "Jan 01, 2023  9:42:10 PM (Read by them after 1 minute)", "+15551234567", "Hi!", "",
    "Jan 01, 2023  9:43:00 PM", "+15551234567", "~/Library/Messages/Attachments/ab/01/IMG_1.heic", "",
  ].join("\n");
  const parsed = parse("export.txt", text);
  assert.equal(parsed.platform, "imessage");
  const conv = only(parsed);
  assert.equal(conv.title, "+15551234567");
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.fromMe, m.text, m.media]), [
    ["Me", true, "Hello there\nsecond line", false], ["+15551234567", false, "Hi!", false], ["+15551234567", false, "", true],
  ]);
  assert.equal(conv.messages[0].at, "2023-01-01T21:41:05.000Z");
});

test("iMazing CSV: quoted newlines, Outgoing/Incoming, empty outgoing sender becomes Me; Chinese-header CSV works too", () => {
  const csv = "﻿Chat Session,Message Date,Type,Sender Name,Text,Attachment\r\n" +
    "Alex,2023-12-25 21:41:05,Outgoing,,\"line one\nline \"\"two\"\"\",\r\n" +
    "Alex,2023-12-25 21:42:00,Incoming,Alex,Thanks!,\r\n" +
    "Alex,2023-12-25 21:43:00,Incoming,Alex,,IMG_1.jpeg\r\n";
  const parsed = parse("imazing.csv", csv);
  assert.equal(parsed.platform, "imessage");
  const conv = only(parsed);
  assert.equal(conv.title, "Alex");
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.fromMe, m.text, m.media]), [
    ["Me", true, 'line one\nline "two"', false], ["Alex", false, "Thanks!", false], ["Alex", false, "", true],
  ]);
  const cn = parse("聊天.csv", "时间,发送者,内容\n2023/12/25 21:41,小明,你好\n2023/12/25 21:42,小红,\"嗨,在吗\"\n");
  assert.equal(cn.platform, "csv");
  assert.deepEqual(only(cn).messages.map((m) => [m.sender, m.text]), [["小明", "你好"], ["小红", "嗨,在吗"]]);
  const us = parse("g.csv", "Date,From,Message\n12/25/2023 9:41:05 PM,A,x\n12/26/2023 9:41:05 AM,B,y\n");
  assert.equal(only(us).messages[0].at, "2023-12-25T21:41:05.000Z");
});

test("SMS Backup XML: entities decode, sent/received map, conversations split by address, MMS text joins", () => {
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<smses count="4">
  <sms protocol="0" address="+15551110000" date="1672574400000" type="1" body="Tom &amp; Jerry &lt;3 &quot;hi&quot; &#10;line2 &#x1F600; &#55357;&#56832; a &gt; b" contact_name="Alex" readable_date="x" />
  <sms protocol="0" address="+15551110000" date="1672574460000" type="2" body="ok" contact_name="Alex" />
  <sms protocol="0" address="+15552220000" date="1672574500000" type="1" body="other" contact_name="(Unknown)" />
  <mms date="1672574600000" msg_box="1" address="+15551110000" contact_name="Alex"><parts><part seq="0" ct="application/smil" text="&lt;smil/&gt;" /><part seq="1" ct="text/plain" text="pic caption" /><part seq="2" ct="image/jpeg" name="a.jpg" /></parts><addrs><addr address="+15551110000" type="137" /></addrs></mms>
</smses>`;
  const parsed = parse("sms.xml", xml);
  assert.equal(parsed.platform, "sms");
  assert.equal(parsed.conversations.length, 2);
  const [alex, other] = parsed.conversations;
  assert.equal(alex.title, "Alex");
  assert.equal(alex.messages[0].text, 'Tom & Jerry <3 "hi" \nline2 \u{1F600} \u{1F600} a > b');
  assert.deepEqual(alex.messages.map((m) => [m.sender, m.fromMe]), [["Alex", false], ["Me", true], ["Alex", false]]);
  assert.deepEqual([alex.messages[2].text, alex.messages[2].media], ["pic caption", true]);
  assert.equal(other.title, "+15552220000");
});

test("Pinky Mac helper JSON: Apple nanosecond dates, attributed bodies (short and long length), attachments", () => {
  const typed = (text, long) => {
    const bytes = Buffer.from(text), lead = Buffer.from("\u0004\u000bstreamtyped....NSString");
    const len = long ? Buffer.from([0x81, bytes.length & 255, bytes.length >> 8]) : Buffer.from([bytes.length]);
    return Buffer.concat([lead, Buffer.from([1, 0x94, 0x84, 1, 0x2b]), len, bytes, Buffer.from("\u0086\u0084")]);
  };
  const long = "x".repeat(200) + "终";
  assert.equal(decodeAttributedBody(typed("hi 😀", false)), "hi 😀");
  assert.equal(decodeAttributedBody(typed(long, true)), long);
  assert.equal(decodeAttributedBody(Buffer.from("garbage")), "");
  assert.equal(decodeAttributedBody(Buffer.concat([Buffer.from("NSString"), Buffer.from([1, 0x94, 0x84, 1, 0x2b, 0x81, 0xff, 0xff])])), "");
  const json = JSON.stringify({ format: "pinky-imessage", chat: { title: "+15551234567" }, rows: [
    { date: 694224000000000000, is_from_me: 1, handle: "+15551234567", text: "hello", body_hex: null, attachments: 0 },
    { date: 694224060000000000, is_from_me: 0, handle: "+15551234567", text: null, body_hex: typed("from blob", false).toString("hex"), attachments: 0 },
    { date: 694224120000000000, is_from_me: 0, handle: "+15551234567", text: "￼", body_hex: null, attachments: 1 },
    { date: 694224180, is_from_me: 0, handle: "+15551234567", text: "old-style seconds", body_hex: null, attachments: 0 },
  ] });
  const parsed = parse("pinky.json", json);
  assert.equal(parsed.platform, "imessage");
  const conv = only(parsed);
  assert.equal(conv.title, "+15551234567");
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.fromMe, m.text, m.media, m.at]), [
    ["Me", true, "hello", false, "2023-01-01T00:00:00.000Z"],
    ["+15551234567", false, "from blob", false, "2023-01-01T00:01:00.000Z"],
    ["+15551234567", false, "", true, "2023-01-01T00:02:00.000Z"],
    ["+15551234567", false, "old-style seconds", false, "2023-01-01T00:03:00.000Z"],
  ]);
});

test("pasted text: Name: lines, WeChat-style blocks, and null for prose", () => {
  const lines = parsePastedText("2023-12-25 21:41 Alex: hello\nSam：你好\nwrapped line\nAlex: bye");
  assert.equal(lines.platform, "text");
  assert.deepEqual(only(lines).messages.map((m) => [m.sender, m.text]), [["Alex", "hello"], ["Sam", "你好\nwrapped line"], ["Alex", "bye"]]);
  assert.equal(only(lines).messages[0].at, "2023-12-25T21:41:00.000Z");
  const wechat = parsePastedText("张三 2023-12-25 21:41\n你好\n李四 2023/12/25 21:42:05\n在吗\n第二行\n张三 21:50\n在的");
  assert.deepEqual(only(wechat).messages.map((m) => [m.sender, m.text, m.at]), [
    ["张三", "你好", "2023-12-25T21:41:00.000Z"], ["李四", "在吗\n第二行", "2023-12-25T21:42:05.000Z"], ["张三", "在的", "2023-12-25T21:50:00.000Z"],
  ]);
  assert.equal(parsePastedText("WhatsApp-ish only one speaker\n12/25/23, 9:41 PM - Alex: a\n12/25/23, 9:42 PM - Alex: b\n12/25/23, 9:43 PM - Alex: c"), null);
  assert.ok(parsePastedText("12/25/23, 9:41 PM - Alex: a\n12/25/23, 9:42 PM - Sam: b\n12/25/23, 9:43 PM - Alex: c"));
  assert.equal(parsePastedText("I had a long day. We talked about dinner, and the plan is: eat out.\nThen we walked home and it was lovely at 9:30\nNothing else happened."), null);
  assert.equal(parsePastedText("Alex: only one line"), null);
  assert.equal(parsePastedText(""), null);
});

test("LINE text export", () => {
  const text = "[LINE] Chat history with Alex\nSaved on: 2023/12/26 08:00\n\n2023.12.25 Monday\n21:41\tAlex\thello\n21:42\tMe\t\"multi\nline\"\n21:43\tAlex joined the chat\n21:44\tAlex\t[Sticker]\n";
  const parsed = parse("line.txt", text);
  assert.equal(parsed.platform, "line");
  const conv = only(parsed);
  assert.equal(conv.title, "Alex");
  assert.deepEqual(conv.messages.map((m) => [m.sender, m.text, m.media]), [["Alex", "hello", false], ["Me", "multi\nline", false], ["Alex", "", true]]);
  assert.equal(conv.messages[0].at, "2023-12-25T21:41:00.000Z");
});

test("generic JSON walker finds a nested message array", () => {
  const data = { meta: { exported: 1 }, payload: { threads: [{ id: 1, items: [{ id: 1 }] }, { id: 2, log: [
    { author: "Ana", body: "hi", sent_at: 1700000000 }, { author: "Bo", body: "yo", sent_at: 1700000060 }, { author: "Ana", body: "later", sent_at: "2023-11-14T22:20:00Z" },
  ] }] } };
  const parsed = parse("export.json", JSON.stringify(data));
  assert.equal(parsed.platform, "text");
  assert.deepEqual(only(parsed).messages.map((m) => [m.sender, m.text]), [["Ana", "hi"], ["Bo", "yo"], ["Ana", "later"]]);
  assert.equal(only(parsed).messages[0].at, "2023-11-14T22:13:20.000Z");
  const meta = parse("e2ee.json", JSON.stringify({ chat: { rows: [{ sender_name: "A", content: "x", timestamp_ms: 1700000000000 }, { sender_name: "B", content: "y", timestamp_ms: 1700000001000 }] } }));
  assert.equal(meta.platform, "messenger");
});

test("caps keep the latest messages and the largest conversations", () => {
  const csv = ["date,sender,text", ...Array.from({ length: 5 }, (_, i) => `2023-01-0${i + 1} 10:00:00,A,m${i}`)].join("\n");
  assert.equal(only(parse("a.csv", csv)).messages.length, 5);
  const rows = Array.from({ length: 205 }, (_, i) => `c${i},2023-01-01 10:00:00,A,hi`.concat(i === 7 ? "\nc7,2023-01-01 10:01:00,A,more" : ""));
  const parsed = parse("many.csv", ["conversation,date,sender,text", ...rows].join("\n"));
  assert.equal(parsed.conversations.length, 200);
  assert.equal(parsed.conversations[0].title, "c7");
});

test("unrecognized and empty input raise ImportFormatError", () => {
  const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 73 + 11) % 256));
  assert.throws(() => parseChatExport({ name: "x.bin", bytes: random }), ImportFormatError);
  assert.throws(() => parseChatExport({ name: "x.txt", bytes: Buffer.alloc(0) }), ImportFormatError);
  assert.throws(() => parse("notes.txt", "Just a paragraph of prose without any chat structure at all."), ImportFormatError);
  assert.throws(() => parse("x.json", JSON.stringify({ a: [1, 2, 3] })), ImportFormatError);
  assert.throws(() => parseChatExport({ name: "x.zip", bytes: makeZip([{ name: "readme.txt", data: "nothing here" }]) }), ImportFormatError);
  assert.throws(() => parse("empty.txt", "12/25/23, 9:41 PM - Messages are encrypted.\n"), ImportFormatError);
});
