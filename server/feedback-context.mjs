import diagnostics from "../shared/feedback-diagnostics.json" with { type: "json" };

const choose = (value, values, fallback = "unknown") => values.includes(value) ? value : fallback;
const checked = (value, pattern, fallback = "unknown") => typeof value === "string" && value.length <= 80 && pattern.test(value) ? value : fallback;
const version = /^\d{1,6}(?:[._-]\d{1,6}){0,4}$/;
const platform = /^(ios|ipados|iphoneos|iphone|ipad|android|macos|windows|linux|web|browser|pwa|native|desktop)$/i;
const model = /^(?:iPhone|iPad|iPod)(?:\d{1,2},\d{1,2}| (?:SE|Pro|Air|mini|\d{1,2})(?: (?:Pro|Max|Plus|mini|Air)){0,2})?$|^(?:Android|Mac|MacIntel|Windows|Linux|Desktop|Web|Pixel(?: \d{1,2}a?(?: Pro| XL)*)?|SM-[A-Z0-9]{2,9})$/i;
export function feedbackContext(input = {}, language) {
  const c = input || {};
  const tz = typeof c.timezone === "string" && c.timezone.length <= 64 ? c.timezone : "";
  let timezone = "unknown";
  try { timezone = new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone; } catch { /* unknown */ }
  const errors = Array.isArray(c.errors) ? c.errors.slice(-20).map((entry) => ({
    message: choose(entry?.message, diagnostics.errors, "Error"),
    stack: typeof entry?.stack === "string" ? entry.stack.split("\n").filter((frame) => /^bundle:\d{1,8}:\d{1,8}$/.test(frame)).slice(0, 8).join("\n") : "",
  })) : [];
  const failures = Array.isArray(c.failed_requests) ? c.failed_requests.filter((entry) => Number.isInteger(entry?.status) && (entry.status === 0 || (entry.status >= 400 && entry.status <= 599))).slice(-10) : [];
  return {
    view: choose(c.view, diagnostics.views), app_version: checked(c.app_version, version), build: checked(c.build, /^(?:\d{1,6}(?:[._-]\d{1,6}){0,4}|[a-f\d]{12})$/i),
    web_commit: checked(c.web_commit, /^[a-f\d]{7,40}$/i), platform: checked(c.platform, platform),
    device_model: checked(c.device_model, model), os_version: checked(c.os_version, /^(?:(?:iOS|iPadOS|Android|macOS|Windows|Linux)[ -])?\d{1,4}(?:[._]\d{1,7}){0,3}$/i),
    locale: checked(c.locale || language, /^[a-z]{2,3}(?:[-_][A-Z][a-z]{3})?(?:[-_][A-Za-z]{2}|-419)?$/),
    timezone, errors, failed_requests: failures.map(({ path, status }) => ({ path: choose(path, diagnostics.routes, "/api/:other"), status })),
  };
}

// The workbench receives user-submitted text as untrusted data. Never forward legacy auto-captured conversation IDs,
// user agents, or the original reply body harvested by the legacy App Review reporting flow.
export function workbenchContext(context) {
  const safe = feedbackContext(context, context?.language);
  if (["partner", "pinky", "other"].includes(context?.report)) safe.report = context.report;
  if (context?.replyFeedback === "unhelpful") safe.replyFeedback = "unhelpful";
  return safe;
}
