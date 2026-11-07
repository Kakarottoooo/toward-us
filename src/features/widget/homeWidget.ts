// The iPhone home-screen widget (server/widget-router.mjs). Inside the Capacitor App, a signed-in member's widget gets its own
// read-only token, handed to the native PinkyWidget plugin, which keeps it in the App Group for the widget to read with. In a
// browser, or an App built without the plugin, every function here is a silent no-op; nothing here may throw into React.
type WidgetPlugin = { setWidgetData(options: { baseUrl: string; token: string }): Promise<unknown>; clear(): Promise<unknown> };
type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { PinkyWidget?: WidgetPlugin } };

function widgetPlugin(): WidgetPlugin | null {
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const plugin = cap?.isNativePlatform?.() ? cap.Plugins?.PinkyWidget : undefined;
    return plugin && typeof plugin.setWidgetData === "function" ? plugin : null;
  } catch { return null; }
}

/** After sign-in and at App start while signed in: a fresh token (replacing the previous one) for the widget. */
export async function connectHomeWidget() {
  try {
    const plugin = widgetPlugin(); if (!plugin) return;
    const response = await fetch("/api/widget/token", { method: "POST", credentials: "same-origin" });
    const token = response.ok ? (await response.json())?.token : null;
    if (typeof token === "string" && token) await plugin.setWidgetData({ baseUrl: location.origin, token });
  } catch { /* the widget simply keeps its last data */ }
}

/** Sign-out: the token stops working and the widget forgets it. Must never hold up signing out. */
export async function disconnectHomeWidget() {
  try {
    const plugin = widgetPlugin(); if (!plugin) return;
    await fetch("/api/widget/token", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    await Promise.resolve().then(() => plugin.clear()).catch(() => {});
  } catch { /* sign-out must still proceed */ }
}
