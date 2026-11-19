import vocabulary from "../../../shared/feedback-diagnostics.json";

type Failure = { path: string; status: number };
type Fault = { message: string; stack: string };
type ShellInfo = { app_version: string; build: string; device_model: string; os_version: string };
type Bridge = { getPlatform?: () => string; Plugins?: { OureverFeedback?: { info: () => Promise<ShellInfo> } } };
const cap = () => (window as Window & { Capacitor?: Bridge }).Capacitor;
const errors: Fault[] = [];
const failedRequests: Failure[] = [];
let device: Partial<ShellInfo> = {};
const routeSet = new Set(vocabulary.routes);
const errorSet = new Set(vocabulary.errors);
const parameterized = vocabulary.routes.filter(route => route.includes("/:id"))
  .map(template => ({ template, pattern: new RegExp("^" + template.replaceAll("/:id", "/[^/]+") + "$") }));

function add<T>(items: T[], entry: T, limit: number) {
  items.push(entry);
  if (items.length > limit) items.shift();
}

function requestPath(input: RequestInfo | URL) {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return null;
    const group = url.pathname.split("/")[2];
    if (routeSet.has(url.pathname)) return url.pathname;
    const matched = parameterized.find(({ pattern }) => pattern.test(url.pathname));
    if (matched) return matched.template;
    const resource = `/api/${group}/:id`;
    return routeSet.has(resource) ? resource : "/api/:other";
  } catch { return null; }
}

function recordError(reason: unknown, fallback: string) {
  // Errors can contain arbitrarily quoted user text. Only transmit known labels and source coordinates.
  const err = reason instanceof Error ? reason : null;
  const message = err && errorSet.has(err.message) ? err.message : err && errorSet.has(err.name) ? err.name : fallback;
  const frames = (err?.stack || "").split("\n").slice(1).flatMap(line => {
    const frame = line.match(/\.([cm]?js|tsx?)(?:\?[^\s():]*)?:(\d{1,8}):(\d{1,8})\)?\s*$/);
    return frame ? [`bundle:${frame[2]}:${frame[3]}`] : [];
  });
  add(errors, { message, stack: frames.slice(0, 8).join("\n") }, 20);
}

// Only product-authored actions qualify for the optional activity attachment.
const activityLabels: Record<string, [string, string, string]> = {
  "start-call": ["开始通话", "Start a call", "Iniciar una llamada"],
  "miss-you": ["发送想念", "Send a thinking-of-you message", "Enviar un saludo afectuoso"],
  "tab-people": ["打开联系人", "Open people", "Abrir personas"],
  "conversation-send": ["发送消息", "Send a message", "Enviar un mensaje"],
  "settings-report": ["打开举报", "Open reporting", "Abrir denuncias"],
  "drawer-games": ["打开游戏", "Open games", "Abrir juegos"],
};
let recentAction: string | undefined;
export function recentFeedbackActivity(language: string) {
  return recentAction ? activityLabels[recentAction][language === "zh" ? 0 : language === "es" ? 2 : 1] : undefined;
}

export function listenFeedbackDiagnostics() {
  recentAction = undefined;
  const onClick = (event: MouseEvent) => {
    const id = event.target instanceof Element ? event.target.closest("[data-testid]")?.getAttribute("data-testid") : null;
    if (id && Object.hasOwn(activityLabels, id)) recentAction = id;
  };
  document.addEventListener("click", onClick, true);
  errors.length = failedRequests.length = 0;
  const logError = console.error;
  const trackedError: typeof console.error = (...args) => {
    recordError(args.find(value => value instanceof Error), "Error");
    logError.apply(console, args);
  };
  console.error = trackedError;
  const previous = window.fetch;
  const tracked: typeof fetch = async (input, init) => {
    const path = requestPath(input);
    try {
      const response = await previous.call(window, input, init);
      if (path && !response.ok) add(failedRequests, { path, status: response.status }, 10);
      return response;
    } catch (error) {
      if (path) add(failedRequests, { path, status: 0 }, 10);
      throw error;
    }
  };
  window.fetch = tracked;
  const onError = (e: Event) => e instanceof ErrorEvent ? recordError(e.error, "Error") : recordError(null, "Resource load error");
  const onRejection = (e: PromiseRejectionEvent) => recordError(e.reason, "Unhandled rejection");
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  void cap()?.Plugins?.OureverFeedback?.info().then(info => { device = info; }).catch(() => {});
  return () => {
    recentAction = undefined;
    if (console.error === trackedError) console.error = logError;
    document.removeEventListener("click", onClick, true);
    if (window.fetch === tracked) window.fetch = previous;
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    errors.length = failedRequests.length = 0;
  };
}

export function feedbackView(fallback: string) {
  const active = document.querySelector<HTMLElement>("[data-feedback-view]")?.dataset.feedbackView;
  return active && vocabulary.views.includes(active) ? active : vocabulary.views.includes(fallback) ? fallback : "unknown";
}

export function getFeedbackContext(from: string, language: string) {
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const os = ua.match(/(?:Android |(?:CPU (?:iPhone )?OS|Mac OS X) |Windows NT )([\d._]+)/)?.[1]?.replaceAll("_", ".");
  const browserModel = ios ? (/iPhone/.test(ua) ? "iPhone" : "iPad") :
    /Android/.test(ua) ? ua.match(/\b(Pixel \d{1,2}a?(?: Pro)?(?: XL)?|SM-[A-Z0-9]{2,9})\b/)?.[1] || "Android" :
    /Mac OS X/.test(ua) ? "Mac" : /Windows NT/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const version = import.meta.env.VITE_WEB_VERSION || null;
  const sha = import.meta.env.VITE_WEB_COMMIT || null;
  const platform = cap()?.getPlatform?.() || "web";
  return {
    view: vocabulary.views.includes(from) ? from : "unknown",
    app_version: device.app_version || (platform === "web" ? version : null),
    build: device.build || (platform === "web" ? sha?.slice(0, 12) || null : null),
    web_commit: sha, platform,
    device_model: device.device_model || browserModel,
    os_version: device.os_version || os || null, locale: language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    errors: [...errors], failed_requests: [...failedRequests],
  };
}
