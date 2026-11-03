import { useEffect, useRef, useState } from "react";
import { CheckCircle, ImageSquare, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { PageHeader, shrink } from "../conversation/ConversationHome";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./feedback.css";

type Sent = { id: string; text: string; photoIds: string[]; kind: string | null; status: string; createdAt: string };
type Shot = { key: string; preview: string; id: string | null; failed?: boolean };

// Feedback about Pinky itself: what happened, where, and screenshots. Only the sender sees it here; the team reads the
// sorted queue. The page the person came from is sent along so a bug can be found.
export function FeedbackPage({ language, from, onBack }: { language: Language; from: string; onBack: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [text, setText] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sent, setSent] = useState<Sent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => relationshipApi<{ feedback: Sent[] }>("/api/feedback").then((result) => setSent(result.feedback)).catch(() => {});
  useEffect(() => { void load(); }, []);
  const kinds: Record<string, string> = { bug: t("问题", "Bug", "Error"), friction: t("不顺手", "Friction", "Fricción"), design: t("设计", "Design", "Diseño"), idea: t("想法", "Idea", "Idea"), praise: t("夸奖", "Praise", "Elogio"), other: t("其他", "Other", "Otro") };
  const pick = async (files: FileList | null) => {
    for (const file of [...(files || [])].filter((item) => item.type.startsWith("image/")).slice(0, 6 - shots.length)) {
      const key = crypto.randomUUID(), preview = URL.createObjectURL(file);
      setShots((items) => [...items, { key, preview, id: null }]);
      try {
        const response = await fetch("/api/photos?scope=private", { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: await shrink(file) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "");
        setShots((items) => items.map((item) => item.key === key ? { ...item, id: payload.photo.id } : item));
      } catch { setShots((items) => items.map((item) => item.key === key ? { ...item, failed: true } : item)); setNotice(t("截图没传上去，可以再试一次。", "A screenshot did not upload; try again.", "Una captura no se subió; inténtalo de nuevo.")); }
    }
  };
  const ready = shots.filter((item) => item.id).map((item) => item.id!);
  const uploading = shots.some((item) => !item.id && !item.failed);
  const send = async () => {
    if ((!text.trim() && !ready.length) || busy || uploading) return;
    keyboard.hide(); setBusy(true); setNotice("");
    try {
      await relationshipApi("/api/feedback", jsonBody({ text, photoIds: ready, context: { view: from }, language }));
      setText(""); setShots([]); setNotice(t("收到了，谢谢你！我们会认真看每一条。", "Got it, thank you! We read every one.", "¡Recibido, gracias! Leemos cada uno."));
      void load();
    } catch { setNotice(t("没发出去，请稍后再试。", "It did not send. Please try again.", "No se envió. Inténtalo de nuevo.")); }
    finally { setBusy(false); }
  };
  return <div className="paper-screen relationship-shell feedback-screen">
    <PageHeader language={language} title={t("反馈", "Feedback", "Comentarios")} onBack={onBack} />
    <main className="relationship-main"><div className="feedback-body" data-testid="feedback-screen">
      <p className="feedback-lead">{t("哪里不好用、哪里坏了、想要什么，都可以直接说。附上截图会更快找到问题。", "Tell us what's broken, what's awkward or what you wish it did. A screenshot helps us find it faster.", "Cuéntanos qué falla, qué incomoda o qué te gustaría. Una captura nos ayuda a encontrarlo antes.")}</p>
      <div className="feedback-input"><KeyboardTextarea aria-label={t("你的反馈", "Your feedback", "Tus comentarios")} value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={4000} placeholder={t("比如：点了发送没反应……", "For example: tapping send did nothing…", "Por ejemplo: al tocar enviar no pasó nada…")} /></div>
      {!!shots.length && <div className="feedback-shots">{shots.map((item) => <figure key={item.key} className={item.failed ? "failed" : item.id ? "" : "uploading"}><img src={item.preview} alt="" draggable={false} /><button type="button" onClick={() => setShots((items) => items.filter((entry) => entry.key !== item.key))} aria-label={t("移除截图", "Remove screenshot", "Quitar captura")}><X size={14} weight="bold" /></button></figure>)}</div>}
      <div className="card-actions">
        <button type="button" onClick={() => { keyboard.hide(); fileRef.current?.click(); }} disabled={shots.length >= 6}><ImageSquare size={18} />{t("加截图", "Add screenshot", "Añadir captura")}</button>
        <button type="button" className="card-primary" disabled={busy || uploading || (!text.trim() && !ready.length)} onClick={() => void send()} data-testid="feedback-send">{t("发送", "Send", "Enviar")}</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void pick(event.target.files); event.target.value = ""; }} />
      {notice && <p className="feedback-notice" role="status">{notice}</p>}
      {!!sent.length && <section className="feedback-sent"><h2>{t("我发过的", "What I've sent", "Lo que he enviado")}</h2>
        {sent.map((item) => <article key={item.id}><header><CheckCircle size={14} weight="fill" />{item.kind ? kinds[item.kind] || kinds.other : t("已收到", "Received", "Recibido")}<time>{new Date(item.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : language)}</time></header><p>{item.text || t("（截图）", "(screenshot)", "(captura)")}</p></article>)}
      </section>}
    </div></main>
  </div>;
}
