// Small membership facts the app needs while it opens, kept apart from the membership screen so that loads on demand.

// A beta invite link (/?beta=CODE) keeps its code here until the person is signed in and it is redeemed.
export const BETA_KEY = "pinky-beta-code";

/** True inside the iPhone app. There Apple's rules (App Review 3.1.1) allow only in-app purchase: no web checkout, no
 * links to it, and no codes that unlock membership. Without the StoreKit bridge the iPhone app simply cannot buy yet. */
export function inIosApp(): boolean {
  try { const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor; return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios"); } catch { return false; }
}

/** The newest iPhone app build testers can install. Raise it with each release that changes the native app, so an
 * older app asks to update (founder 11-22: a friend's TestFlight app was still a build without Apple/Google sign-in). */
export const LATEST_IOS_BUILD = "2611.19.16";
export const IOS_UPDATE_URL = "https://testflight.apple.com/join/DzCw2zD9";

/** True when build `a` (like "2611.19.8") is older than build `b`; parts compare as numbers. */
export function buildIsOlder(a: string, b: string): boolean {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** The iPhone app's build number, or null outside it. An app without the App plugin is older than any listed build. */
export async function iosAppBuild(): Promise<string | null> {
  if (!inIosApp()) return null;
  try {
    const app = (window as unknown as { Capacitor?: { Plugins?: { App?: { getInfo?: () => Promise<{ build?: string }> } } } }).Capacitor?.Plugins?.App;
    return app?.getInfo ? String((await app.getInfo()).build || "0") : "0";
  } catch { return null; }
}
