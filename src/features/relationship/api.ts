import { currentLanguage, apiErrorText } from "../../i18n";

export async function relationshipApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  }).catch(error => {
    if (error instanceof TypeError) throw new Error(apiErrorText({ code: "network_unavailable" }, 0, currentLanguage()));
    throw error;
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  // A Chinese server message never reaches an English or Spanish screen.
  if (!response.ok && payload.code === "ai_daily_limit" && payload.upgrade === true && !payload.background) window.dispatchEvent(new Event("ourever:free-limit"));
  if (!response.ok) throw Object.assign(new Error(apiErrorText(payload, response.status, currentLanguage())), { status: response.status, code: payload.code });
  return payload as T;
}

export const jsonBody = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
