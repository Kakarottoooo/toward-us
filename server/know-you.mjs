import { keepMessages } from "./thread-pages.mjs";
import { randomUUID } from "node:crypto";
import { gettingToKnow } from "./profile.mjs";

// 让 Pinky 认识你 (founder 11-08: "我们的产品应该自动知道呀"): Pinky judges from what it has kept about a member, never from them
// saying they are new. While it barely knows them, the first time they open Just me it speaks first: it says it does not
// know them well yet and asks the first question right away, no permission asked. Their answers go on through the normal
// conversation (the planner keeps asking, one question per reply, while gettingToKnow holds) and land in About us.
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const partnerName = (context, userId, language) => context?.members.find((member) => member.userId !== userId)?.user?.name || say(language, "TA", "your partner", "tu pareja");
function greeting(language, partner, talked) {
  return talked
    ? say(language, `我发现我还不太了解你，想问你几个问题，以后帮你和 ${partner} 出主意会更准。先问一个：你不开心的时候，最希望 ${partner} 怎么对你？\n不想答就直接说你想做的事；也可以点右上角电话，用说的。`,
      `I realize I don't know you very well yet, so let me ask a few questions; it'll make my ideas for you and ${partner} better. First one: when you're upset, how do you most want ${partner} to treat you?\nIf you'd rather not, just tell me what you need; or tap the phone at the top right and talk.`,
      `Me doy cuenta de que aún no te conozco bien; déjame hacerte unas preguntas para ayudarte mejor con ${partner}. La primera: cuando estás mal, ¿cómo quieres que ${partner} te trate?\nSi prefieres no responder, dime lo que necesitas; o toca el teléfono arriba a la derecha y habla.`)
    : say(language, `嗨，我是 Ourever。不知道怎么回 ${partner} 的时候，把 TA 的话或聊天截图发给我，我帮你看懂意思、写好回复。我还不太了解你，想先问你几个问题，以后帮你和 ${partner} 出主意会更准。第一个：你不开心的时候，最希望 ${partner} 怎么对你？\n不想答就直接说你想做的事；也可以点右上角电话，用说的。`,
      `Hi, I'm Ourever. When you don't know how to reply to ${partner}, send me what they said or a screenshot and I'll help you read it and write a reply. I don't know you yet, so let me ask a few questions first; it'll make my ideas for you and ${partner} better. First one: when you're upset, how do you most want ${partner} to treat you?\nIf you'd rather not, just tell me what you need; or tap the phone at the top right and talk.`,
      `Hola, soy Ourever. Cuando no sepas qué responderle a ${partner}, envíame lo que dijo o una captura y te ayudo a entenderlo y a escribir una respuesta. Aún no te conozco, así que déjame hacerte unas preguntas; así te ayudaré mejor con ${partner}. La primera: cuando estás mal, ¿cómo quieres que ${partner} te trate?\nSi prefieres no responder, dime lo que necesitas; o toca el teléfono arriba a la derecha y habla.`);
}

/** Posts Pinky's opening question in this private session, once per member. Returns the updated session or null. */
export async function askToKnow(store, { userId, session, now = new Date() }) {
  if (!session || session.channel || session.status !== "active") return null;
  if (!(await gettingToKnow(store, userId))) return null;
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId);
  if (threads.some((thread) => thread.knowYouAt)) return null;
  const context = await store.getRelationshipContext(userId);
  const language = session.language || "zh";
  const partner = partnerName(context, userId, language);
  // Someone who has already talked with Pinky is not greeted as if they had just arrived.
  const talked = threads.some((thread) => (thread.messages || []).some((message) => message.role === "user"));
  const text = greeting(language, partner, talked);
  return store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
    if (draft.knowYouAt) return;
    keepMessages(draft, [...draft.messages, { id: randomUUID(), role: "assistant", text, knowYou: true, knowYouTalked: talked, createdAt: now.toISOString() }]);
    draft.knowYouAt = now.toISOString(); draft.version += 1;
  }));
}

// The opening question names the partner, and it stays in the conversation (and in Pinky's context). After leaving a
// relationship, re-pairing with someone new, or the partner deleting their account, the greeting is rewritten with the
// current partner's name, or the neutral "TA" / "your partner" when there is none, so an ex's name is never shown again.
const legacyTalked = /^(我发现我还不太了解你|I realize I don't know you|Me doy cuenta de que)/;
export async function refreshKnowYou(store, userId) {
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId && thread.knowYouAt);
  if (!threads.length) return 0;
  const context = await store.getRelationshipContext(userId);
  let changed = 0;
  for (const thread of threads) {
    const language = thread.language || "zh";
    const partner = partnerName(context, userId, language);
    const isGreeting = (message) => message.role === "assistant" && (message.knowYou || message.createdAt === thread.knowYouAt);
    const rewrite = (message) => {
      if (!isGreeting(message)) return message;
      const talked = typeof message.knowYouTalked === "boolean" ? message.knowYouTalked : legacyTalked.test(String(message.text || ""));
      const text = greeting(language, partner, talked);
      return text === message.text ? message : { ...message, text, knowYou: true, knowYouTalked: talked };
    };
    const needs = [...(thread.messages || []), ...(thread.earlier || []).flatMap((page) => page.messages || [])].some((message) => rewrite(message) !== message);
    if (!needs) continue;
    await store.transaction(`user:${userId}`, (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, userId, (draft) => {
      draft.messages = (draft.messages || []).map(rewrite);
      if (draft.earlier) draft.earlier = draft.earlier.map((page) => ({ ...page, messages: (page.messages || []).map(rewrite) }));
      draft.version += 1;
    }));
    changed += 1;
  }
  return changed;
}
