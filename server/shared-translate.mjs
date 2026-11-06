import { asAiUser } from "./ai-budget.mjs";

// 各看各的语言 (founder 11-06): "我选择了英文系统，对面选择了中文系统，那就按照系统的语言来显示". What Pinky writes in Us is
// stored once, in the language of whoever it was written for. When the member opening Us has picked another language, each
// recent Pinky line in the other script is translated once in the background and kept on the message
// (`translations[language]`), and the App shows that. Same-language couples never pay for a call. Members' own words are
// never translated, and fixed system copy already carries every language (`i18n`).

const RECENT = 40;
const LABEL = { zh: "Simplified Chinese", en: "English", es: "Spanish" };
const han = (text) => (String(text || "").match(/\p{Script=Han}/gu) || []).length;
const latin = (text) => (String(text || "").match(/\p{Script=Latin}/gu) || []).length;
/** Whether a text is mostly in another script than the viewer's language: a short "来！" counts, a name like 子薇 inside an
 * English line does not (English and Spanish share one script, so between those two nothing is translated). */
export const needsTranslation = (text, language) => language === "zh" ? latin(text) >= 6 && han(text) * 3 < latin(text) : han(text) >= 1 && han(text) * 3 >= latin(text);

const schema = { type: "object", additionalProperties: false, required: ["text", "options"], properties: { text: { type: "string" }, options: { type: "array", items: { type: "string" } } } };
const instructions = (language) => `Translate this message from Pinky, a couple's companion, into ${LABEL[language]}. Keep its warmth, meaning, names, emoji, line breaks and URLs exactly; do not add or explain anything. options are the answer choices of a little game shown with the message: translate each one in order and keep them just as short (return [] when there are none).`;

/** Messages a viewer in `language` would otherwise read in another script. */
export function untranslated(messages, language) {
  return (messages || []).slice(-RECENT).filter((message) => message.role === "agent" && !message.i18n && !message.translations?.[language]
    && (needsTranslation(message.text, language) || (message.game?.options || []).some((option) => needsTranslation(option, language))));
}

export function createSharedTranslator({ store, mediator, emit = () => {} }) {
  const running = new Set();
  /** Fire and forget from the read path: the reply goes out at once, the translations follow with a refresh. */
  function ensure({ relationshipId, userId, language, messages }) {
    if (!mediator?.structured || !LABEL[language]) return;
    const todo = untranslated(messages, language).filter((message) => !running.has(`${message.id}:${language}`));
    if (!todo.length) return;
    for (const message of todo) running.add(`${message.id}:${language}`);
    void asAiUser({ userId, language }, async () => {
      const done = {};
      for (const message of todo) {
        try {
          const options = message.game?.options || [];
          const result = await mediator.structured({ name: "shared_translation", schema, instructions: instructions(language), input: JSON.stringify({ text: message.text, options }), maxOutputTokens: 1500 });
          const text = String(result?.text || "").trim().slice(0, 4000);
          if (!text) continue;
          const translated = Array.isArray(result.options) && result.options.length === options.length ? result.options.map((option) => String(option || "").trim().slice(0, 80)) : options;
          done[message.id] = { text, ...(options.length ? { options: translated } : {}) };
        } catch (error) { console.error("Shared translation failed:", error?.message || error); if (error?.code === "ai_daily_limit") break; }
      }
      if (!Object.keys(done).length) return;
      const conversation = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
        const current = await tx.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
        if (!current) return null;
        return tx.updateRelationshipRecordForUser("togetherConversations", current.id, userId, (draft) => {
          draft.messages = draft.messages.map((item) => done[item.id] ? { ...item, translations: { ...(item.translations || {}), [language]: done[item.id] } } : item);
          draft.version += 1;
        });
      });
      if (conversation) emit(conversation);
    }).catch((error) => console.error("Shared translation failed:", error?.message || error)).finally(() => { for (const message of todo) running.delete(`${message.id}:${language}`); });
  }
  return { ensure };
}
