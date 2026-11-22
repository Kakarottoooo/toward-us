// Small membership facts the app needs while it opens, kept apart from the membership screen so that loads on demand.

// A beta invite link (/?beta=CODE) keeps its code here until the person is signed in and it is redeemed.
export const BETA_KEY = "pinky-beta-code";

/** True inside the iPhone app. There Apple's rules (App Review 3.1.1) allow only in-app purchase: no web checkout, no
 * links to it, and no codes that unlock membership. Without the StoreKit bridge the iPhone app simply cannot buy yet. */
export function inIosApp(): boolean {
  try { const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor; return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios"); } catch { return false; }
}
