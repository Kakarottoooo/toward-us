// Letters and time capsules (founder 11-06): written with Pinky in Just me and confirmed by the writer, then kept on the writer's own
// private record until the day. Nothing goes out from Pinky ("不应该从我们这里发出去"): no envelope in Us, nothing on the shared
// calendar, so the surprise stays a surprise. On the day Pinky reminds the writer, privately, and hands them the letter with one
// tap to send it themselves by message or email (or to read it aloud).
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
export const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const todayIn = (timezone, now = new Date()) => { try { return now.toLocaleDateString("en-CA", { timeZone: timezone || "UTC" }); } catch { return now.toISOString().slice(0, 10); } };
/** The day a letter is for, if it is a real day after today where the writer is; otherwise it is an ordinary message. */
export const openingDay = (value, timezone, now = new Date()) => isDay(value) && value > todayIn(timezone, now) ? value : null;

/** The hand-offs for a letter: the writer's own Messages app and Mail, the words already in. */
export const letterHandoffs = (text, language) => [
  { kind: "link", title: say(language, "用短信 / iMessage 发给 TA", "Send by text message", "Enviar por mensaje"), url: `sms:&body=${encodeURIComponent(text)}` },
  { kind: "link", title: say(language, "用邮件发给 TA", "Send by email", "Enviar por correo"), url: `mailto:?subject=${encodeURIComponent(say(language, "给你的一封信", "A letter for you", "Una carta para ti"))}&body=${encodeURIComponent(text)}` },
];

/** Every letter whose day has come where its writer is: a private note to the writer with the letter and the hand-offs, and a push.
 * `postNote(userId, { sessionId, language, text, cards })` writes into the writer's Just me; `notify(userId, { body, url, tag })`
 * pushes. Each letter is marked done once its note is written, so it is handed over once. Safe to run every few minutes. */
export async function deliverLetters({ store, now = () => new Date(), postNote = async () => {}, notify = async () => {} }) {
  let delivered = 0;
  for (const thread of await store.listRecordsForJob("privateAgentThreads")) {
    for (const letter of Array.isArray(thread.letters) ? thread.letters : []) {
      if (letter.deliveredAt || !isDay(letter.openOn) || letter.openOn > todayIn(thread.timezone, now())) continue;
      try {
        const userId = thread.ownerUserId, language = thread.language || "zh";
        const cards = letterHandoffs(letter.text, language).map((card, index) => ({ id: `letter:${letter.cardId}:${index}`, version: 1, ...card }));
        await postNote(userId, { sessionId: thread.id, language, cards, text: say(language,
          `💌 今天是你想把这封信交给 TA 的日子。\n\n${letter.text}\n\n点下面，用你自己的短信或邮件发给 TA；也可以当面念给 TA 听。`,
          `💌 Today is the day you wanted to give your partner this letter.\n\n${letter.text}\n\nTap below to send it yourself by text or email, or read it to them in person.`,
          `💌 Hoy es el día en que querías darle esta carta a tu pareja.\n\n${letter.text}\n\nToca abajo para enviarla tú por mensaje o correo, o léesela en persona.`) });
        await store.transaction(`letters:${thread.id}`, (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, userId, (draft) => {
          draft.letters = (draft.letters || []).map((item) => item.cardId === letter.cardId ? { ...item, deliveredAt: now().toISOString() } : item); draft.version += 1;
        }));
        await notify(userId, { body: { zh: "💌 今天是给 TA 那封信的日子", en: "💌 Today's the day for your letter", es: "💌 Hoy es el día de tu carta" }, url: "/?channel=me", tag: `pinky-letter-${letter.cardId}`.slice(0, 64) }).catch(() => {});
        delivered += 1;
      } catch (error) { console.error("Letter reminder will retry on the next tick:", error?.message || error); }
    }
  }
  return { delivered };
}
