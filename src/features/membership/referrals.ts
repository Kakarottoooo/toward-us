import { relationshipApi } from "../relationship/api";

export type ReferralRules = { calls: number; days: number; windowDays: number; rewardDays: number; monthlyCap: number };
export type ReferralPreview = { initial: string; rules: ReferralRules };
type Progress = { state: "registered" | "using" | "activated" | "capped" | "expired"; activeDays: number };
export type Reward = { source: "referral" | "feedback"; days: number; at: string; until: string };
export type ReferralAccount = { code: string; rules: ReferralRules; invited: Array<Progress & { initial: string }>; totalDays: number; monthCount: number; rewards: Reward[]; received: Progress | null };

export const referralCode = () => new URLSearchParams(location.search).get("ref") || "";
export function clearReferral() {
  const url = new URL(location.href);
  url.searchParams.delete("ref");
  history.replaceState(history.state, "", url);
}

// This origin-scoped random identifier survives signing out. Do not fingerprint hardware or derive it from an account.
const installKey = "ourever.referral.install";
export function referralInstallId() {
  try {
    const saved = localStorage.getItem(installKey);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(installKey, id);
    return id;
  } catch { return ""; }
}
export function loadReferrals(signal?: AbortSignal) {
  return relationshipApi<ReferralAccount>("/api/referrals/me", { signal, cache: "no-store", headers: { "x-install-id": referralInstallId() } });
}
