import { Component, lazy, useState, type ComponentType, type ReactNode } from "react";

const RELOADED_AT = "ourever.screen-reload-at";

function typing() {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden]):not([type=file])")].some((field) => field.value.trim());
}

/** A screen file can fail to load when a deploy replaced it after this page opened, or the network dropped. Load the
 * current version of the app once instead, unless something is being typed or it was just reloaded for this reason. */
function loadOrReload<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((error) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOADED_AT)) || 0; } catch { /* storage unavailable */ }
    if (Date.now() - last < 30_000 || typing()) throw error;
    try { sessionStorage.setItem(RELOADED_AT, String(Date.now())); } catch { throw error; }
    location.reload();
    return new Promise<T>(() => {});
  });
}

/**
 * A component whose code is downloaded on demand. `preload()` fetches it ahead of time; once it has arrived the screen
 * renders straight away, without passing through a Suspense fallback. Before then it suspends like React.lazy.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => pending ??= loadOrReload(load).then(
    (component) => (loaded = component),
    (error) => { pending = null; throw error; },
  );
  const Lazy = lazy(() => preload().then((component) => ({ default: component }))) as unknown as ComponentType<P>;
  function Screen(props: P) {
    // Chosen once per mount, so a screen that mounted while loading is never remounted when its code arrives.
    const [Render] = useState(() => loaded ?? Lazy);
    return <Render {...props} />;
  }
  return Object.assign(Screen, { preload: () => preload().then(() => undefined, () => undefined) });
}

/** Shown in place of a screen whose code could not be loaded, with a way to try again. */
export class ScreenBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
