import { currentLanguage, inInterfaceLanguage } from "../../i18n";

export async function relationshipApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  // A Chinese server message never reaches an English or Spanish screen.
  if (!response.ok) throw Object.assign(new Error(inInterfaceLanguage(String(payload.error || `Request failed (${response.status})`), currentLanguage())), { status: response.status, code: payload.code });
  return payload as T;
}

export const jsonBody = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
