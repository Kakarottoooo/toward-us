import { jsonBody, relationshipApi } from "../relationship/api";

export type SignInProvider = "google" | "apple";
type SignInOptions = { adultConfirmed: boolean; partnerInviteCode?: string; referralCode?: string; installId: string };
type AuthBridge = { open(options: { url: string }): Promise<{ code?: string; error?: string }> };
type NativeShell = { isNativePlatform(): boolean; getPlatform(): string; Plugins?: { OureverSignIn?: AuthBridge } };

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const returnKey = "ourever.signin.return";
const returnFields = ["ref", "invite", "next", "view"] as const;

// A browser redirect returns to the app root. Restore only the navigation fields supported by this app.
export function restoreSignInNavigation() {
  try {
    const item = sessionStorage.getItem(returnKey);
    if (!item) return false;
    sessionStorage.removeItem(returnKey);
    const { savedAt, search } = JSON.parse(item);
    if (Date.now() - savedAt > 10 * 60_000 || typeof search !== "string") return false;
    const saved = new URLSearchParams(search);
    const url = new URL(location.href);
    for (const key of returnFields) if (!url.searchParams.has(key) && saved.has(key)) url.searchParams.set(key, saved.get(key)!);
    history.replaceState(history.state, "", url);
    return true;
  } catch { return false; }
}

// Keep the verifier in the initiating web view. Only the disposable handoff code travels in the app URL.
export async function startProviderSignIn(provider: SignInProvider, options: SignInOptions) {
  const shell = (window as Window & { Capacitor?: NativeShell }).Capacitor;
  const native = shell?.isNativePlatform();
  const bridge = native && shell?.getPlatform() === "ios" ? shell.Plugins?.OureverSignIn : undefined;
  if (native && !bridge?.open) return "update_required";
  const verifier = bridge ? base64url(crypto.getRandomValues(new Uint8Array(32))) : "";
  const challenge = verifier ? base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))) : undefined;
  const { url } = await relationshipApi<{ url: string }>(`/api/auth/oauth/${provider}/start`, jsonBody({ ...options, challenge }));
  const start = new URL(url, location.origin);
  if (start.origin !== location.origin || start.pathname !== `/api/auth/oauth/${provider}/authorize`) throw new Error("invalid_start");
  if (!bridge) {
    try {
      const current = new URLSearchParams(location.search);
      const saved = new URLSearchParams();
      for (const key of returnFields) if (current.has(key)) saved.set(key, current.get(key)!);
      sessionStorage.setItem(returnKey, JSON.stringify({ savedAt: Date.now(), search: saved.toString() }));
    } catch { /* The server still owns the sign-in and invitation context. */ }
    location.assign(start.href);
    return "redirect";
  }
  const result = await bridge.open({ url: start.href });
  if (result.error || !result.code) return result.error || "failed";
  try { await relationshipApi("/api/auth/oauth/exchange", jsonBody({ code: result.code, verifier })); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code && ["link_required", "adult_required", "referral_ineligible"].includes(code)) return code;
    throw error;
  }
  return "success";
}
