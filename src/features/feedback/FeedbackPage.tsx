import { useEffect, useRef, useState } from "react";
import { ImageSquare, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { PageHeader } from "../conversation/ConversationHome";
import { getFeedbackContext } from "./feedbackDiagnostics";
import { FeedbackInbox } from "./FeedbackInbox";
import { FeedbackVoice } from "./FeedbackVoice";
import { insertVoiceText, notifyVoice, type VoiceTake } from "./feedbackVoiceQueue";
import {
  deliveryEvent, discardFailedFeedback, enqueueFeedback, pendingFeedback, readDraft, retryFeedback, saveDraft,
  type FeedbackDraft, type FeedbackKind, type PendingFeedback,
} from "./feedbackQueue";
import "./feedback.css";

type Props = { language: Language; from: string; onBack: () => void; backLabel?: string; userId: string; activity?: string; initialFile?: File };
const types = ["image/png", "image/jpeg", "image/webp", "image/heic"];
const accepted = (file: File) => file.size > 0 && file.size <= 5 * 1024 * 1024 &&
  (types.includes(file.type.toLowerCase()) || (!file.type && /\.(png|jpe?g|webp|heic)$/i.test(file.name)));
const namedFile = (file: File) => {
  if (file.type) return file;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return new File([file], file.name, { type: "image/" + (ext === "jpg" ? "jpeg" : ext), lastModified: file.lastModified });
};

function Shot({ file, label, remove, removeLabel }: { file: File; label: string; remove: () => void; removeLabel: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview); setFailed(false);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return <figure>{url && !failed ? <img src={url} onError={() => setFailed(true)} alt={label} draggable={false} /> : <figcaption>{label}</figcaption>}
    <button type="button" aria-label={removeLabel} onClick={remove}><X size={15} weight="bold" /></button></figure>;
}

// Remount the entire private form if the selected account changes.
export function FeedbackPage(props: Props) { return <OwnedFeedbackPage key={props.userId} {...props} />; }

function OwnedFeedbackPage({ language, from, onBack, backLabel, userId, activity, initialFile }: Props) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [initial] = useState(() => ({ from, language, file: initialFile, context: getFeedbackContext(from, language) }));
  const empty = (): FeedbackDraft => ({ text: "", kind: "bug", images: [], context: getFeedbackContext(from, language) });
  const [draft, setDraft] = useState<FeedbackDraft>({ text: "", kind: "bug", images: [], context: initial.context });
  const latest = useRef(draft);
  const updateDraft = (next: FeedbackDraft) => { latest.current = next; setDraft(next); };
  const editor = useRef<HTMLDivElement>(null);
  const beforeBack = useRef<((leave: () => void) => void) | null>(null);
  const cursor = useRef<number | undefined>(undefined);
  const inserted = useRef(new Set<string>());
  const [voiceBusy, setVoiceBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState<"" | "invalid" | "received" | "queued">("");
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<PendingFeedback[]>([]);
  const [discard, setDiscard] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSave = useRef(0);
  useEffect(() => {
    let live = true, version = 0;
    readDraft(userId).then(async (saved) => {
      if (!live) return;
      const restored = saved || { text: "", kind: "bug" as const, images: [], context: initial.context };
      const file = initial.file;
      if (file && !restored.images.some((image) => image.name === file.name && image.size === file.size && image.lastModified === file.lastModified)) {
        if (restored.images.length === 4 || !accepted(file)) setNotice("invalid");
        else {
          restored.images = [...restored.images, namedFile(file)];
          updateDraft(restored);
          await saveDraft(userId, restored);
        }
      }
      if (live) { updateDraft(restored); setReady(true); }
    }).catch(() => { if (live) { setStorageError(true); setReady(true); } });
    const refresh = async () => {
      const current = ++version;
      try {
        const entries = await pendingFeedback(userId);
        if (live && current === version) {
          setPending(entries.sort((a, b) => b.created - a.created));
          if (entries.some((item) => item.failure)) setNotice((value) => value === "queued" ? "" : value);
        }
      } catch { if (live) setStorageError(true); }
    };
    const changed = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data.owner !== userId) return;
      if (data.sent) setNotice("received");
      void refresh();
    };
    const connection = () => setOnline(navigator.onLine);
    void refresh();
    window.addEventListener(deliveryEvent, changed);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => {
      live = false; window.removeEventListener(deliveryEvent, changed);
      window.removeEventListener("online", connection); window.removeEventListener("offline", connection);
    };
  }, [initial, userId]);

  const persist = async (next: FeedbackDraft) => {
    const seq = ++lastSave.current;
    const ids = [...inserted.current];
    try {
      await saveDraft(userId, next, ids);
      if (seq === lastSave.current) setStorageError(false);
      if (ids.length) {
        for (const id of ids) inserted.current.delete(id);
        notifyVoice(userId);
      }
    } catch (error) {
      if (seq === lastSave.current) setStorageError(true);
      throw error;
    }
  };
  const edit = (next: FeedbackDraft) => {
    if (!ready || submitting.current) return;
    updateDraft(next); setNotice("");
    void persist(next).catch(() => {});
  };
  const insertTranscripts = async (takes: VoiceTake[]) => {
    const fresh = takes.filter(take => !inserted.current.has(take.id));
    if (!fresh.length) return;
    let text = latest.current.text;
    for (const take of fresh) {
      const result = insertVoiceText(text, take);
      text = result.text; cursor.current = result.caret;
      inserted.current.add(take.id);
    }
    const next = { ...latest.current, text };
    updateDraft(next); setNotice("");
    requestAnimationFrame(() => {
      const input = editor.current?.querySelector("textarea");
      if (input && input.value === next.text && cursor.current !== undefined) input.setSelectionRange(cursor.current, cursor.current);
    });
    await persist(next);
  };
  const pick = (files: FileList | null) => {
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    if (chosen.length + draft.images.length > 4 || !chosen.every(accepted)) { setNotice("invalid"); return; }
    edit({ ...draft, images: [...draft.images, ...chosen.map(namedFile)] });
  };
  const send = async () => {
    if (submitting.current || voiceBusy || !draft.text.trim() || draft.text.length > 4000 || !ready) return;
    keyboard.hide(); submitting.current = true; setBusy(true); setNotice("");
    try {
      await enqueueFeedback(userId, draft);
      ++lastSave.current; setStorageError(false); updateDraft(empty()); cursor.current = undefined; setNotice("queued");
    } catch { setStorageError(true); }
    finally { submitting.current = false; setBusy(false); }
  };
  const context = draft.context;
  const kinds: [FeedbackKind, string][] = [["bug", t("报问题", "Report a bug", "Informar de un error")], ["suggestion", t("提建议", "Suggest an idea", "Sugerir una idea")], ["other", t("其他", "Other", "Otro")]];
  const fields: [string, string][] = [
    ["view", t("页面", "Screen", "Pantalla")], ["app_version", t("应用版本", "App version", "Versión")],
    ["build", t("构建号", "Build", "Compilación")], ["web_commit", t("网页包提交号", "Web commit", "Revisión web")],
    ["platform", t("平台", "Platform", "Plataforma")], ["device_model", t("机型", "Device model", "Modelo")],
    ["os_version", t("系统版本", "OS version", "Versión del sistema")], ["locale", t("语言", "Language", "Idioma")],
    ["timezone", t("时区", "Time zone", "Zona horaria")],
  ];
  const failures = {
    network: t("发送失败，将自动重试", "Couldn’t send. Will retry automatically.", "No se pudo enviar. Se reintentará automáticamente."),
    session: t("请重新登录原账号后重试", "Sign back into this account and retry.", "Vuelve a iniciar sesión en esta cuenta e inténtalo de nuevo."),
    image: t("服务器无法读取图片", "The server couldn’t read an image.", "El servidor no pudo leer una imagen."),
    rate: t("已达提交上限，稍后自动重试", "Submission limit reached. Will retry later.", "Límite de envíos alcanzado. Se reintentará más tarde."),
    rejected: t("服务器未接受这条反馈", "This feedback was not accepted.", "No se aceptó este comentario."),
  };
  const providedActivity = activity?.trim() || String(context.view || from);
  const errorRows = Array.isArray(context.errors) ? context.errors as { message: string; stack: string }[] : [];
  const failedRows = Array.isArray(context.failed_requests) ? context.failed_requests as { path: string; status: number }[] : [];
  const noEntries = t("无", "None", "Ninguno");
  const retry = t("重试", "Retry", "Reintentar");
  const localAction = (task: Promise<void>) => void task.catch(() => setStorageError(true));
  return <div className="paper-screen relationship-shell feedback-screen">
    <PageHeader language={language} title={t("反馈", "Feedback", "Comentarios")} backLabel={backLabel} onBack={() => beforeBack.current ? beforeBack.current(onBack) : onBack()} />
    <main className="relationship-main"><div className="feedback-body" data-testid="feedback-screen">
      <fieldset className="feedback-fields" disabled={!ready || busy}>
        <legend>{t("反馈类型", "Feedback type", "Tipo de comentario")}</legend>
        <div className="feedback-kinds">{kinds.map(([kind, label]) => <button type="button" key={kind} aria-pressed={draft.kind === kind} onClick={() => edit({ ...draft, kind })}>{label}</button>)}</div>
        <div className="feedback-input" ref={editor}><label htmlFor="feedback-description">{t("发生了什么？", "What happened?", "¿Qué ha ocurrido?")}</label>
          <KeyboardTextarea id="feedback-description" onSelect={event => { cursor.current = event.currentTarget.selectionEnd; }} onBlur={event => { cursor.current = event.currentTarget.selectionEnd; keyboard.hide(); }} aria-label={t("你的反馈", "Your feedback", "Tus comentarios")} value={draft.text} onChange={event => { cursor.current = event.currentTarget.selectionEnd; edit({ ...latest.current, text: event.currentTarget.value }); }}
            rows={5} maxLength={4000} required placeholder={t("描述问题或写下你的建议…", "Describe the issue or share an idea…", "Describe el problema o comparte una idea…")} />
          <div className="feedback-character-count"><small>{draft.text.length} / 4000</small></div>
          {draft.text.length > 4000 && <p role="alert">{t("请将反馈缩短到 4000 字以内再提交。", "Shorten your feedback to 4,000 characters before sending.", "Acorta el comentario a 4000 caracteres antes de enviarlo.")}</p>}
          {ready && <FeedbackVoice owner={userId} language={language} online={online} beforeBack={beforeBack} onBusy={setVoiceBusy} insert={insertTranscripts}
            position={() => { keyboard.hide(); return { base: latest.current.text, position: cursor.current ?? latest.current.text.length }; }} />}
        </div>
        {!!draft.images.length && <div className="feedback-shots">{draft.images.map((file, i) => <Shot key={i} file={file}
          label={t("截图", "Screenshot", "Captura") + " " + (i + 1)} removeLabel={t("移除截图", "Remove screenshot", "Quitar captura") + " " + (i + 1)}
          remove={() => edit({ ...draft, images: draft.images.filter((_, index) => index !== i) })} />)}</div>}
        <button className="feedback-attach" type="button" disabled={draft.images.length >= 4} onClick={() => { keyboard.hide(); fileRef.current?.click(); }}><ImageSquare size={18} />
          {t("添加截图", "Add screenshots", "Añadir capturas")} ({draft.images.length}/4)</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,.heic" multiple hidden onChange={(event) => { pick(event.target.files); event.target.value = ""; }} />
        <label className="feedback-consent"><input type="checkbox" checked={draft.activity !== undefined}
          onChange={(event) => edit({ ...draft, activity: event.target.checked ? providedActivity : undefined })} />
          {t("附上我刚才在做的事", "Attach what I was just doing", "Adjuntar lo que estaba haciendo")}</label>
        {draft.activity !== undefined && <p className="feedback-activity">{draft.activity}</p>}
        <details className="feedback-diagnostics"><summary>{t("我们还会发送哪些信息", "What else we send", "Qué más enviaremos")}</summary>
          <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{String(context[key] ?? t("未知", "Unknown", "Desconocido"))}</dd></div>)}</dl>
          <strong>{t("最近报错", "Recent errors", "Errores recientes")} ({errorRows.length}/20)</strong>
          {errorRows.length ? errorRows.map((row, i) => <pre key={i}>{row.message}{row.stack ? "\n" + row.stack : ""}</pre>) : <p>{noEntries}</p>}
          <strong>{t("最近失败的请求", "Recent failed requests", "Solicitudes fallidas recientes")} ({failedRows.length}/10)</strong>
          {failedRows.length ? failedRows.map((row, i) => <pre key={i}>{row.path} · {row.status}</pre>) : <p>{noEntries}</p>}
        </details>
      </fieldset>
      {!online && <p className="feedback-notice">{t("当前离线。提交后会保存在此设备，联网后自动发送。", "You’re offline. Submissions stay on this device and send when you reconnect.", "Sin conexión. Los envíos se guardan en este dispositivo y se enviarán al volver a conectarte.")}</p>}
      <div className="card-actions"><button type="button" className="card-primary" disabled={!ready || busy || voiceBusy || !draft.text.trim() || draft.text.length > 4000} onClick={() => void send()} data-testid="feedback-send">
        {busy ? t("正在提交…", "Submitting…", "Enviando…") : t("提交反馈", "Submit feedback", "Enviar comentario")}</button></div>
      {storageError && <p role="alert">{t("无法保存到此设备，内容仍在此页。请释放空间后重试。", "Couldn’t save on this device. Your changes are still on this page. Free up space and retry.", "No se pudo guardar en este dispositivo. Los cambios siguen en esta página. Libera espacio y reintenta.")} <button type="button" onClick={() => edit(draft)}>{retry}</button></p>}
      {notice && <p className="feedback-notice" role="status">{notice === "invalid" ? t("请选最多 4 张 PNG、JPEG、WebP 或 HEIC 图片，每张不超过 5 MB。", "Choose up to 4 PNG, JPEG, WebP or HEIC images, up to 5 MB each.", "Elige hasta 4 imágenes PNG, JPEG, WebP o HEIC de hasta 5 MB cada una.") :
        notice === "received" ? t("已收到你的反馈。", "We received your feedback.", "Hemos recibido tu comentario.") :
        online ? t("正在发送反馈…", "Sending feedback…", "Enviando comentario…") : t("反馈已暂存在此设备。", "Feedback saved on this device.", "Comentario guardado en este dispositivo.")}</p>}
      {!!pending.length && <section className="feedback-sent"><h2>{t("等待发送", "Outbox", "Pendientes de envío")}</h2>
        {pending.map((item) => <article key={item.id}><strong>{item.failure ? failures[item.failure] : online ? t("正在发送…", "Sending…", "Enviando…") : t("等待联网", "Waiting for connection", "Esperando conexión")}</strong>
          <p>{item.text}</p>
          {item.failure && <div className="card-actions">{discard === item.id ? <>
            <button type="button" onClick={() => setDiscard("")}>{t("取消", "Cancel", "Cancelar")}</button>
            <button type="button" onClick={() => { localAction(discardFailedFeedback(userId, item.id)); setDiscard(""); }}>{t("确认移除", "Confirm removal", "Confirmar eliminación")}</button>
          </> : <>
            <button type="button" disabled={!online || (item.failure === "rate" && item.retryAt > Date.now())} onClick={() => localAction(retryFeedback(userId, item.id))}>{retry}</button>
            <button type="button" onClick={() => setDiscard(item.id)}>{t("移除", "Remove", "Eliminar")}</button>
          </>}</div>}</article>)}
      </section>}
      <FeedbackInbox language={language} />
    </div></main>
  </div>;
}
