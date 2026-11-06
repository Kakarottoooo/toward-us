import type { Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";

export type ImportPerson = { name: string; count: number; role: "me" | "partner" | "other" };
export type PersonStats = { messages: number; words: number; initiations: number; replyMinutesMedian: number | null; lateNight: number };
export type ChatImport = {
  id: string; title: string; platform: string; status: "needs_choice" | "needs_people" | "analyzing" | "ready" | "failed" | "waiting_sync"; error: string | null;
  shared: boolean; ownerUserId: string; createdAt: string; conversations?: Array<{ id: string; title: string; count: number; participants: string[]; lastAt: string | null }>;
  people: ImportPerson[]; messageCount: number; firstAt: string | null; lastAt: string | null; progress: { done: number; total: number } | null; sampled: boolean; rawDeleted: boolean;
  shareRequestedAt: string | null; sharedCopyId: string | null; sync: { lastSyncAt: string | null } | null;
  stats: { perPerson: { me: PersonStats; partner: PersonStats }; monthly: Array<{ month: string; me: number; partner: number }>; silences: Array<{ from: string; to: string; days: number }>; busiestDays: Array<{ date: string; count: number }>; activeDays: number } | null;
  analysis: {
    message: string; overview: string; conflictCycle: string | null;
    patterns: Array<{ title: string; detail: string; evidence: Array<{ date: string | null; speaker: string | null; quote: string }> }>;
    strengths: Array<{ title: string; detail: string }>; hurts: Array<{ speaker: string; detail: string }>; suggestions: Array<{ title: string; detail: string }>;
    moments: Array<{ date: string | null; title: string; text: string }>; dates: Array<{ date: string; title: string; yearly: boolean }>;
    promises: Array<{ date: string | null; speaker: string; text: string; status: "kept" | "open" | "unclear" }>; safety: { concern: boolean; note: string | null };
  } | null;
};

/** Sends an exported chat file as-is; the server recognizes the format. Octet-stream keeps JSON exports away from the app-wide JSON parser. */
export async function uploadChatFile(file: Blob, { name, language, session }: { name: string; language: Language; session?: string | null }) {
  const query = new URLSearchParams({ name, language, ...(session ? { session } : {}) });
  const response = await fetch(`/api/imports?${query}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: file });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Upload failed (${response.status})`);
  return payload.import as ChatImport;
}

export async function importPastedChat(text: string, { language, session }: { language: Language; session?: string | null }) {
  const query = new URLSearchParams({ pasted: "1", language, ...(session ? { session } : {}) });
  const response = await fetch(`/api/imports?${query}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "text/plain; charset=utf-8" }, body: text });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Import failed (${response.status})`);
  return payload.import as ChatImport;
}

export const getImport = (id: string) => relationshipApi<{ import: ChatImport }>(`/api/imports/${encodeURIComponent(id)}`).then((result) => result.import);
export const listImports = () => relationshipApi<{ imports: ChatImport[] }>("/api/imports").then((result) => result.imports);
export const importAction = (id: string, action: string, body: unknown = {}) => relationshipApi<{ import?: ChatImport }>(`/api/imports/${encodeURIComponent(id)}/${action}`, jsonBody(body));

/** Text a chat export file usually is; images go through the photo path instead. */
export const isChatFile = (file: File) => /\.(txt|zip|json|csv|xml|html?)$/i.test(file.name) || /^(text\/|application\/(zip|json|xml|x-zip))/.test(file.type);
/** A long, multi-line paste that reads like a conversation is imported instead of being sent as one message. */
export const looksLikePastedChat = (text: string) => text.length > 1500 && text.split("\n").filter((line) => line.trim()).length >= 8;
