// The first-run steps saved on this device, in their own small file so opening the app can check them without loading
// the first-run screen itself.
export type Draft = { step: 1 | 2 | 3; name: string };

export const draftKey = (id: string) => "ourever:first-run:" + id;
export const firstRunInProgress = (id: string) => Boolean(readDraft(draftKey(id)));

export function readDraft(key: string): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || "null");
    return draft && [1, 2, 3].includes(draft.step) && typeof draft.name === "string" ? draft : null;
  } catch { return null; }
}
