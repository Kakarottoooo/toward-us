// A member may have no name: sign-ups that skip it store an empty name (QA round 7, finding 3; older accounts had the
// placeholder "我", cleared when the store loads). Wherever a name would be shown, these give words in the reader's language.
const pick = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;

/** The partner, as their partner reads it: "对方" / "your partner" / "tu pareja" (capitalized for the start of a sentence). */
export const partnerWord = (language, start = false) => pick(language, "对方", start ? "Your partner" : "your partner", start ? "Tu pareja" : "tu pareja");
/** Either member, in a line both of them read (Us announcements). */
export const eitherWord = (language) => pick(language, "你们中的一位", "One of you", "Uno de ustedes");
/** The name, else the fallback. */
export const nameOr = (name, fallback) => String(name || "").trim() || fallback;
/** True for the server's old no-name placeholder, which is never a name to show. */
export const placeholderName = (user) => user?.name === "我" && (!user.nameSource || user.nameSource === "fallback");
