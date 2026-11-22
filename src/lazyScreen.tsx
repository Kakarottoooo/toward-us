import { Component, lazy, useState, type ComponentType, type ReactNode } from "react";

const RELOADED_AT = "ourever.screen-reload-at";

function typing() {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden]):not([type=file])")].some((field) => field.value.trim());
}

/** True only when the server answers: a screen file that failed while the server is reachable was replaced by a deploy. */
async function serverReachable() {
  if (navigator.onLine === false) return false;
  try { return (await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) })).ok; } catch { return false; }
}

/** A screen file can fail to load when a deploy replaced it after this page opened, or the network dropped. After a deploy,
 * load the current version of the app once instead, unless something is being typed or it was just reloaded for this
 * reason. Offline it never reloads (that would show the browser's own error page); the screen shows the offline state and
 * loads again once the connection is back. */
function loadOrReload<T>(load: () => Promise<T>): Promise<T> {
  return load().catch(async (error) => {
    if (!(await serverReachable())) throw error;
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOADED_AT)) || 0; } catch { /* storage unavailable */ }
    if (Date.now() - last < 30_000 || typing()) throw error;
    try { sessionStorage.setItem(RELOADED_AT, String(Date.now())); } catch { throw error; }
    location.reload();
    return new Promise<T>(() => {});
  });
}

// Screens whose code failed to arrive; a retry gives each a fresh loader (React.lazy keeps a failure for good).
const failedScreens = new Set<() => void>();

/**
 * A component whose code is downloaded on demand. `preload()` fetches it ahead of time; once it has arrived the screen
 * renders straight away, without passing through a Suspense fallback. Before then it suspends like React.lazy.
 * Only showing the screen may reload the page after a deploy; fetching ahead of time never does.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const attempt = (mayReload: boolean) => pending ??= (mayReload ? loadOrReload(load) : load()).then(
    (component) => (loaded = component),
    (error) => { pending = null; failedScreens.add(reset); throw error; },
  );
  const makeLazy = () => lazy(() => attempt(true).then((component) => ({ default: component }))) as unknown as ComponentType<P>;
  let Lazy = makeLazy();
  const reset = () => { Lazy = makeLazy(); };
  function Screen(props: P) {
    // Chosen once per mount, so a screen that mounted while loading is never remounted when its code arrives.
    const [Render] = useState(() => loaded ?? Lazy);
    return <Render {...props} />;
  }
  return Object.assign(Screen, { preload: () => attempt(false).then(() => undefined, () => undefined) });
}

/** Shown in place of a screen whose code could not be loaded, with a way to try again. Coming back online tries again
 * by itself, and so does a change of `resetKey` (the screen shown). */
export class ScreenBoundary extends Component<{ fallback: ReactNode | ((retry: () => void) => ReactNode); children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  retry = () => {
    if (!this.state.failed) return;
    for (const reset of failedScreens) reset();
    failedScreens.clear();
    this.setState({ failed: false });
  };
  componentDidMount() { window.addEventListener("online", this.retry); }
  // Moving to another screen (Back, offline) leaves the failed one behind instead of staying on its error (QA round 3).
  componentDidUpdate(previous: { resetKey?: string }) { if (previous.resetKey !== this.props.resetKey) this.retry(); }
  componentWillUnmount() { window.removeEventListener("online", this.retry); }
  render() {
    const { fallback } = this.props;
    return this.state.failed ? typeof fallback === "function" ? fallback(this.retry) : fallback : this.props.children;
  }
}
