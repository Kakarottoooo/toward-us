import { useEffect, useRef, useState } from "react";
import { ChatCircleText, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { listenFeedbackDiagnostics } from "./feedbackDiagnostics";
import "./feedback-entry.css";

type Listener = { remove: () => void };
type Shell = { Plugins?: { OureverFeedback?: {
  addListener: (event: string, handle: () => void) => Listener | Promise<Listener>;
} } };

export function FeedbackEntry({ userId, language, hidden, open }: {
  userId: string; language: Language; hidden: boolean; open: (image?: File) => void;
}) {
  const [count, setCount] = useState(0);
  const [screenshot, setScreenshot] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  useEffect(() => listenFeedbackDiagnostics(), [userId]);
  // The delivery queue (and its voice queue) is fetched after the first screen is drawn; it only retries saved reports.
  useEffect(() => {
    let live = true, stop: (() => void) | undefined;
    import("./feedbackQueue").then((queue) => { if (live) stop = queue.startFeedbackDelivery(userId); }, () => {});
    return () => { live = false; stop?.(); };
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    const refresh = async () => {
      if (document.hidden || !navigator.onLine) return;
      const seq = ++revision;
      try {
        const response = await fetch("/api/feedback/mine?unread=count", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const { unread } = await response.json();
        if (seq === revision && !controller.signal.aborted && Number.isInteger(unread)) setCount(unread);
      } catch { /* next foreground refresh */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("feedback-updated", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("feedback-updated", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [userId]);
  useEffect(() => {
    const shell = (window as Window & { Capacitor?: Shell }).Capacitor;
    const registration = Promise.resolve().then(() => shell?.Plugins?.OureverFeedback?.addListener("screenshot", () => setScreenshot(true))).catch(() => undefined);
    return () => { void registration.then(handle => handle?.remove()); };
  }, []);
  useEffect(() => { if (hidden) setScreenshot(false); }, [hidden, screenshot]);
  useEffect(() => {
    if (!screenshot) return;
    const timer = window.setTimeout(() => setScreenshot(false), 8000);
    return () => window.clearTimeout(timer);
  }, [screenshot]);
  if (hidden) return null;
  const label = t("反馈", "Feedback", "Comentarios");
  return <>
    <button type="button" className="feedback-launch" aria-label={count ? t(`反馈，${count} 条新回复`, `Feedback, ${count} ${count === 1 ? "update" : "updates"}`, `Comentarios, ${count} novedades`) : label}
      title={label} onClick={() => open()} data-testid="feedback-entry"><ChatCircleText size={19} />{count > 0 && <small>{count > 99 ? "99+" : count}</small>}</button>
    {screenshot && <aside className="feedback-screenshot" role="status">
      <button type="button" onClick={() => file.current?.click()}>{t("选择刚截的图并反馈", "Report with the screenshot", "Informar con la captura")}</button>
      <button type="button" aria-label={t("关闭", "Dismiss", "Cerrar")} onClick={() => setScreenshot(false)}><X size={16} /></button>
      <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp,image/heic,.heic" onChange={e => {
        const image = e.target.files?.[0]; if (image) { setScreenshot(false); open(image); }
      }} />
    </aside>}
  </>;
}
