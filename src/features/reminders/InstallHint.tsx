import { useEffect, useState } from "react";
import { BottomSheet } from "../../mobile";
import { localized, type Language } from "../../i18n";
import { canPromptInstall, inAppBrowser, isIOS, isStandalone, onInstallPromptChange, promptInstall } from "./webPush";
import { inNativeApp, nativePushPlugin } from "./nativePush";
import { inIosApp } from "../membership/platform";

const SEEN_KEY = "toward-us-install-hint-seen";
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage may be unavailable */ } };
// The menu, a sheet or another full-screen layer is open: the hint waits until it is closed instead of covering it.
const somethingOpen = () => Boolean(document.querySelector(".conversation-drawer-layer, [role=dialog], [data-layer-open]"));

/** Once, gently: how to put Ourever on the Home Screen (iPhone: Share → Add to Home Screen; Chrome: its own install prompt).
 * Shown at most once per browser, never inside the App or an already installed web app, never on a desktop, and only after
 * the welcome tour, so the two never cover each other. */
export function InstallHint({ language, userId }: { language: Language; userId: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [kind, setKind] = useState<"ios" | "inapp" | "prompt" | null>(null);
  useEffect(() => {
    if (seen() || isStandalone() || inNativeApp() || inIosApp() || nativePushPlugin()) return;
    // Leave the first signed-in visit free for the private conversation.
    try {
      const visit = "ourever:first-home:" + userId;
      if (!localStorage.getItem(visit)) { localStorage.setItem(visit, "1"); sessionStorage.setItem(visit, "1"); }
      if (sessionStorage.getItem(visit)) return;
    } catch { return; }
    let timer = 0;
    const decide = () => {
      if (somethingOpen()) { timer = window.setTimeout(decide, 1500); return; }
      setKind((current) => current || (isIOS() ? (inAppBrowser() ? "inapp" : "ios") : canPromptInstall() ? "prompt" : null));
    };
    // A moment after the screen settles, so it never covers the first look at the conversation.
    timer = window.setTimeout(decide, 1500);
    const stop = onInstallPromptChange(() => { if (canPromptInstall()) { window.clearTimeout(timer); timer = window.setTimeout(decide, 1500); } });
    return () => { window.clearTimeout(timer); stop(); };
  }, [userId]);
  useEffect(() => { if (kind) markSeen(); }, [kind]);
  const close = () => setKind(null);
  const install = async () => { await promptInstall(); close(); };
  return <BottomSheet open={Boolean(kind)} onOpenChange={(next) => { if (!next) close(); }} title={t("把 Ourever 放到主屏幕", "Put Ourever on your Home Screen", "Pon Ourever en tu pantalla de inicio")} snap={0.46}>
    <div className="install-hint">
      <p>{t("像 App 一样从主屏幕打开，TA 说话、每日一问和纪念日都能收到通知。", "Open it like an app, and get notified when your partner writes, for the daily question and for your special days.", "Ábrela como una app y recibe avisos cuando tu pareja escriba, con la pregunta del día y en sus fechas especiales.")}</p>
      {kind === "ios" && <ol>
        <li>{t("点 Safari 底部（或顶部）的“分享”按钮", "Tap Safari's Share button (bottom or top of the screen)", "Toca el botón Compartir de Safari (abajo o arriba)")}</li>
        <li>{t("选择“添加到主屏幕”", "Choose \"Add to Home Screen\"", "Elige \"Añadir a pantalla de inicio\"")}</li>
        <li>{t("从主屏幕打开 Ourever，在“设置 → 通知”里打开通知", "Open Ourever from the Home Screen and turn on notifications in Settings → Notifications", "Abre Ourever desde la pantalla de inicio y activa las notificaciones en Ajustes → Notificaciones")}</li>
      </ol>}
      {kind === "inapp" && <p>{t("先点右上角“···”，选择“在 Safari 中打开”，再从 Safari 添加到主屏幕。", "First tap \"···\" in the top corner and choose \"Open in Safari\", then add it to the Home Screen from Safari.", "Primero toca \"···\" arriba y elige \"Abrir en Safari\"; después añádela a la pantalla de inicio desde Safari.")}</p>}
      <div className="install-hint-actions">
        {kind === "prompt" && <button type="button" className="install-hint-primary" onClick={() => void install()}>{t("安装 Ourever", "Install Ourever", "Instalar Ourever")}</button>}
        <button type="button" className={kind === "prompt" ? "install-hint-secondary" : "install-hint-primary"} onClick={close}>{kind === "prompt" ? t("以后再说", "Not now", "Ahora no") : t("知道了", "Got it", "Entendido")}</button>
      </div>
    </div>
  </BottomSheet>;
}
