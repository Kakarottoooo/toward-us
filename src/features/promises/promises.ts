import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";

// "还欠着什么" (11-03): promises Pinky noticed in the two conversations. The server decides who sees which one; a partner's
// private promise never reaches this phone.
export type PromiseItem = {
  id: string; version: number; description: string; when: string; by: "me" | "partner" | "both"; shared: boolean;
  status: "open" | "kept"; later: boolean; quote: string | null; saidBy: "me" | "partner" | null; saidAt: string; keptAt: string | null;
  agreement: { id: string; version: number; status: string } | null; shareText?: string;
};
export type PromiseAction = "done" | "later" | "dismiss" | "reopen" | "agreement" | "share";

export const listPromises = (language: Language) => relationshipApi<{ promises: PromiseItem[] }>(`/api/promises?language=${language}`).then((result) => result.promises);
export const promiseToMention = (language: Language) => relationshipApi<{ promise: PromiseItem | null }>(`/api/promises/nudge?language=${language}`).then((result) => result.promise);
export const actOnPromise = (item: PromiseItem, action: PromiseAction, language: Language, extra: Record<string, unknown> = {}) =>
  relationshipApi<{ promise: PromiseItem | null }>(`/api/promises/${encodeURIComponent(item.id)}/${action}`, jsonBody({ version: item.version, language, ...extra }));

/** "You promised: …" / "Blair promised: …" / "You both agreed: …", in the reader's language. */
export function promiseLead(item: PromiseItem, partnerName: string, language: Language) {
  const what = item.when ? `${item.description}${language === "zh" ? `（${item.when}）` : ` (${item.when})`}` : item.description;
  if (item.by === "me") return localized(language, `你答应过：${what}`, `You promised: ${what}`, `Prometiste: ${what}`);
  if (item.by === "partner") return localized(language, `${partnerName} 答应过：${what}`, `${partnerName} promised: ${what}`, `${partnerName} prometió: ${what}`);
  return localized(language, `你们说好了：${what}`, `You both agreed: ${what}`, `Quedaron en: ${what}`);
}
