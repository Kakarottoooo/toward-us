import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CaretRight, LockKey, UsersThree, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, KeyboardTextarea, MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { FitPairSection, FitSection, FitState, SupportReview } from "./types";
import "./fit.css";

type Props = {
  language: Language; userId: string; paired: boolean; onBack: () => void;
  onInvite: () => void; onDiscuss: (text: string) => void;
};
type Translate = (zh: string, en: string, es: string) => string;
const mbtiTypes = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];
const zodiacNames = [
  ["aries", "白羊座", "Aries", "Aries"], ["taurus", "金牛座", "Taurus", "Tauro"],
  ["gemini", "双子座", "Gemini", "Géminis"], ["cancer", "巨蟹座", "Cancer", "Cáncer"],
  ["leo", "狮子座", "Leo", "Leo"], ["virgo", "处女座", "Virgo", "Virgo"],
  ["libra", "天秤座", "Libra", "Libra"], ["scorpio", "天蝎座", "Scorpio", "Escorpio"],
  ["sagittarius", "射手座", "Sagittarius", "Sagitario"], ["capricorn", "摩羯座", "Capricorn", "Capricornio"],
  ["aquarius", "水瓶座", "Aquarius", "Acuario"], ["pisces", "双鱼座", "Pisces", "Piscis"],
];
const rememberedFlow = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };

export function FitPage({ language, userId, paired, onBack, onInvite, onDiscuss }: Props) {
  const t: Translate = (zh, en, es) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const flowKey = `pinky:fit-flow:${userId}`;
  const [data, setData] = useState<FitState | null>(null);
  const [view, setView] = useState<"mine" | "couple">("mine");
  const [flow, setFlow] = useState(() => {
    const saved = rememberedFlow(flowKey);
    return saved === "starter" ? "support" : saved;
  });
  const [showNotes, setShowNotes] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ id: string; value: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sheet, setSheet] = useState<"share" | "profile" | "delete" | "edit" | null>(null);
  const [profileDraft, setProfileDraft] = useState({ mbti: "", zodiac: "" });
  const [sheetVersion, setSheetVersion] = useState<number | null>(null);
  const [wording, setWording] = useState("");
  const writes = useRef(false);
  const refreshAfterWrite = useRef(false);
  const request = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (writes.current) { refreshAfterWrite.current = true; return; }
    const ticket = ++request.current;
    try {
      const next = await relationshipApi<FitState>(`/api/fit?language=${language}`, { signal });
      if (!signal?.aborted && ticket === request.current) { setData(next); setError(""); }
    } catch (caught) {
      if (!signal?.aborted && ticket === request.current) setError((caught as Error).message);
    } finally { if (!signal?.aborted && ticket === request.current) setLoading(false); }
  }, [language, userId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && navigator.onLine) void load(); };
    const connected = () => { setOnline(true); refresh(); };
    const disconnected = () => setOnline(false);
    const events = paired ? new EventSource("/api/relationship/events") : null;
    events?.addEventListener("relationship", (event) => {
      try { if (JSON.parse((event as MessageEvent).data).eventType === "fit.updated") refresh(); } catch { /* Ignore malformed events. */ }
    });
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      events?.close();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [paired, load]);
  const setQuestionFlow = (next: string) => {
    keyboard.hide(); setFlow(next); setIndex(null); setChoice(null); setError("");
    try { if (next) localStorage.setItem(flowKey, next); else localStorage.removeItem(flowKey); } catch { /* Current session still works. */ }
  };
  const support = data?.modules.find((module) => module.id === "support");
  const questions = data?.modules.find((module) => module.id === flow)?.questions || [];
  const firstMissing = questions.findIndex((question) => !data?.profile.answers[question.id]);
  const currentIndex = Math.min(index ?? (firstMissing < 0 ? 0 : firstMissing), Math.max(questions.length - 1, 0));
  const question = flow && questions[currentIndex];
  const selected = question ? choice?.id === question.id ? choice.value : data?.profile.answers[question.id] || "" : "";
  const supportSeen = support?.questions.filter(item => data?.profile.answers[item.id]).length || 0;
  const supportDone = Boolean(support && supportSeen === support.questions.length);
  const canShare = Boolean(data?.profile.canShare);
  const finish = () => {
    setShowNotes(Boolean(flow && flow !== "support"));
    setQuestionFlow(""); setView("mine");
  };
  useEffect(() => { const scroll = contentRef.current?.closest<HTMLElement>(".mobile-scroll"); if (scroll) scroll.scrollTop = 0; }, [flow, currentIndex, view]);
  const mutate = async (path: string, body: Record<string, unknown> = {}, remove = false) => {
    if (!data || writes.current || !online) return false;
    writes.current = true; request.current++; setBusy(true); setError(""); keyboard.hide();
    try {
      const next = await relationshipApi<FitState>(remove ? `/api/fit?version=${data.profile.version}&language=${language}` : `/api/fit/${path}`,
        remove ? { method: "DELETE" } : jsonBody({ version: data.profile.version, language, ...body }));
      setData(next);
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      if ((caught as { status?: number }).status === 409) refreshAfterWrite.current = true;
      return false;
    } finally {
      writes.current = false; setBusy(false);
      if (refreshAfterWrite.current) { refreshAfterWrite.current = false; void load(); }
    }
  };
  const nextQuestion = async (answer = selected) => {
    if (!question || !answer) return;
    if (answer !== data?.profile.answers[question.id] && !await mutate("answers", { answers: { [question.id]: answer } })) return;
    setChoice(null);
    if (currentIndex === questions.length - 1) finish();
    else setIndex(currentIndex + 1);
  };
  const closeSheet = () => { keyboard.hide(); setSheet(null); };
  const title = t("我们有多合拍", "How we connect", "Así conectamos");
  const profileTitle = t("MBTI 与星座", "MBTI & zodiac", "MBTI y signo");
  const reportSections = data?.personal?.sections || [];
  const discovery = reportSections.find(section => section.id === "support");
  const notes = reportSections.filter(section => section.id !== "support");
  const review = data?.profile.supportReview;
  const openShare = () => {
    if (!data) return;
    keyboard.hide();
    setSheetVersion(data.profile.version);
    setSheet("share");
  };
  const openEdit = () => {
    if (!data) return;
    keyboard.hide();
    setSheetVersion(data.profile.version);
    setWording(review?.kind === "edit" ? review.text : discovery?.summary || "");
    setSheet("edit");
  };
  const saveReview = (kind: SupportReview["kind"], text = "") => mutate("support-review", { kind, text });
  const openSupport = () => { setView("mine"); setQuestionFlow("support"); };
  const startProfile = () => { keyboard.hide(); setProfileDraft({ mbti: data?.profile.mbti || "", zodiac: data?.profile.zodiac || "" }); setSheet("profile"); };
  const goBack = () => { keyboard.hide(); if (flow) finish(); else onBack(); };
  const copyReport = async (couple = false) => {
    if (!data) return;
    const sections = couple ? data.couple.sections : reportSections;
    const summary = couple ? data.couple.summary : data.personal?.summary || "";
    const reportTitle = couple ? title : data.personal?.title || t("我的关系说明书", "My relationship guide", "Mi guía de relación");
    const text = [reportTitle, summary, ...sections.map((section) => `${section.title}\n${section.summary}\n${section.suggestion}`),
      t("根据本人选择的情景回答整理 · Pinky", "Based on self-reported situation answers · Pinky", "Basado en respuestas personales a situaciones · Pinky")].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(t("解析已复制，可以保存或分享。", "Guide copied. You can save or share it.", "Guía copiada. Puedes guardarla o compartirla."));
    } catch { setCopyStatus(t("暂时无法复制，请稍后再试。", "Couldn't copy right now. Please try again.", "No se pudo copiar. Inténtalo de nuevo.")); }
  };

  return <section className="fit-page paper-screen" data-testid="fit-page">
    <header className="fit-header">
      <button type="button" onClick={goBack} aria-label={flow ? t("回到说明书", "Back to your guide", "Volver a tu guía") : t("回到对话", "Back to chat", "Volver al chat")} data-testid="fit-back"><ArrowLeft size={22} /></button>
      <h1>{title}</h1><span aria-hidden="true" />
    </header>
    {!flow && <div className="fit-tabs" role="tablist" aria-label={title}>
      <button type="button" role="tab" aria-selected={view === "mine"} onClick={() => { keyboard.hide(); setView("mine"); }}><LockKey size={17} />{t("我的发现", "My discoveries", "Mis hallazgos")}</button>
      <button type="button" role="tab" aria-selected={view === "couple"} onClick={() => { keyboard.hide(); setView("couple"); }}><UsersThree size={18} />{t("我们俩的解析", "Our connection", "Nuestra conexión")}</button>
    </div>}
    <div className="fit-scroll"><MobileScroll><div className="fit-content" ref={contentRef}>
      {!online && <p className="fit-notice" role="status">{t("你现在离线，已打开的说明书可以继续看。联网后再保存。", "You're offline. You can read this guide; reconnect to save changes.", "Estás sin conexión. Puedes leer tu guía; vuelve a conectarte para guardar cambios.")}</p>}
      {error && <div className="fit-error" role="alert"><p>{error}</p><button type="button" disabled={busy || !online} onClick={() => { setError(""); void load(); }}>{t("重新加载", "Reload", "Volver a cargar")}</button></div>}
      {loading && !data && <p className="fit-notice" role="status">{t("正在打开说明书…", "Opening your guide…", "Abriendo tu guía…")}</p>}
      {question && data ? <div className="fit-question" key={question.id}>
        <div className="fit-question-progress"><span>{currentIndex + 1} / {questions.length}</span><span>{data.modules.find((module) => module.id === flow)?.title}</span></div>
        <progress value={currentIndex + 1} max={questions.length} aria-label={t("答题进度", "Question progress", "Progreso")} />
        <h2>{question.text}</h2>
        <div className="fit-options" role="group" aria-label={t("选择最接近你的反应", "Choose what sounds most like you", "Elige lo que más se parezca a ti")}>
          {question.options.map((option) => <button type="button" key={option.id} aria-pressed={selected === option.id} disabled={busy} onClick={() => setChoice({ id: question.id, value: option.id })} data-testid="fit-option">
            <span>{option.text}</span><i aria-hidden="true">{selected === option.id && <Check size={15} weight="bold" />}</i>
          </button>)}
        </div>
        <button type="button" className="fit-copy" disabled={busy || !online} onClick={() => void nextQuestion("skip")} data-testid="fit-skip">{t("都不像 / 想不起来，跳过", "None fit or I can't recall. Skip", "Ninguna encaja o no lo recuerdo. Saltar")}</button>
        {data.profile.sharing && <p className="fit-fine">{t("修改后，重新确认分享才会更新双人解析。", "After an edit, review and share again to update your connection guide.", "Después de editar, revisa y comparte de nuevo para actualizar la guía de ambos.")}</p>}
        <div className="fit-actions"><button className="fit-primary" type="button" disabled={busy || !online || !selected || selected === "skip"} onClick={() => void nextQuestion()} data-testid="fit-next">{busy ? t("保存中…", "Saving…", "Guardando…") : currentIndex === questions.length - 1 ? t("保存，回看这个主题", "Save & revisit this topic", "Guardar y volver al tema") : t("保存，下一题", "Save & next", "Guardar y continuar")}<ArrowRight size={18} /></button>
          {currentIndex > 0 && <button type="button" className="fit-secondary" disabled={busy} onClick={() => { setChoice(null); setIndex(currentIndex - 1); }}>{t("上一题", "Previous", "Anterior")}</button>}</div>
      </div> : data && view === "mine" ? <>
        {support && <section className="fit-intro fit-support">
          <h2>{support.title}</h2>
          {discovery ? <>
            <div className="fit-finding">
              <p className="fit-status">{discovery.reviewable ? t("我希望你知道", "What I’d like you to know", "Algo que quiero que sepas") : t("目前记下的线索", "What you’ve noticed so far", "Lo que has observado")}</p>
              <h3>{discovery.summary}</h3>
              {discovery.suggestion && <p>{discovery.suggestion}</p>}
              <Evidence section={discovery} t={t} />
            </div>
            {discovery.reviewable && <fieldset className="fit-review">
              <legend>{t("这像你吗？", "Does this sound like you?", "¿Te reconoces en esto?")}</legend>
              {(["fits", "sometimes", "edit"] as const).map(kind =>
                <button key={kind} type="button" disabled={busy || !online} aria-pressed={review?.kind === kind}
                  onClick={() => { if (kind === "edit") openEdit(); else void saveReview(kind); }}>
                  {review?.kind === kind && <Check size={15} />}
                  {kind === "fits" ? t("像我", "That’s me", "Así soy") : kind === "sometimes" ? t("有时候是这样", "Sometimes", "A veces") : t("我想改一句", "In my words", "A mi manera")}
                </button>)}
              {data.profile.sharing && <p className="fit-fine">{t("改动后，要再确认一次，TA 才能看到更新。", "After an edit, share again for your partner to see the update.", "Si haces cambios, vuelve a compartir para que tu pareja vea la actualización.")}</p>}
            </fieldset>}
          </> : <p>{supportDone ? t("这次四题都跳过了。想继续时，回看你有印象的场景就好。", "You skipped all four scenes. If you come back, start with one you remember.", "Omitiste las cuatro situaciones. Si vuelves, empieza por una que recuerdes.") : support.description}</p>}
          <button className={discovery?.reviewable ? "fit-copy" : "fit-primary"} type="button" disabled={busy || !online}
            onClick={openSupport} data-testid="fit-start">{supportDone
              ? t("回看这组回答", "Revisit my answers", "Volver a mis respuestas")
              : supportSeen ? t("继续上次的话题", "Pick up where I left off", "Seguir donde lo dejé") : t("从这个话题开始", "Explore this topic", "Explorar este tema")}<ArrowRight size={17} /></button>
        </section>}
        {canShare && <section className="fit-sharing"><h2>{t("愿意让 TA 更懂你吗？", "Want to let them know you better?", "¿Quieres que tu pareja te conozca mejor?")}</h2><p>{data.profile.sharing
          ? t("你已分享这个版本，随时可以撤回。", "You’ve shared this version. You can withdraw it anytime.", "Compartiste esta versión. Puedes retirar tu permiso cuando quieras.")
          : t("先看看 TA 会看到什么。两个人都同意后，再一起看双人解析。", "See what your partner will get. Your shared insights open once you both agree.", "Revisa qué verá tu pareja. El análisis se abre cuando ambos den su permiso.")}</p>
          {data.profile.sharing ? <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>
            : paired ? <button type="button" className="fit-primary" disabled={busy || !online} onClick={openShare} data-testid="fit-preview-share">{t("预览，再分享给 TA", "Preview & share with them", "Revisar y compartir")}<ArrowRight size={18} /></button>
              : <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>}
        </section>}
        <details className="fit-other" open={showNotes} onToggle={event => setShowNotes(event.currentTarget.open)}><summary>{t("其他主题与我的记录", "Other topics & my notes", "Otros temas y mis notas")}<CaretRight size={18} /></summary>
          <div className="fit-chapters">{data.modules.filter(module => module.id !== "support").map((module) => {
            const answered = module.questions.filter((item) => data.profile.answers[item.id] && data.profile.answers[item.id] !== "skip").length;
            return <button className="fit-chapter" type="button" key={module.id} onClick={() => setQuestionFlow(module.id)} disabled={busy} data-testid={`fit-module-${module.id}`}><span><strong>{module.title}</strong><small>{module.description}</small></span><span className="fit-chapter-count">{answered}/{module.questions.length}<CaretRight size={17} /></span></button>;
          })}</div>
          {notes.map(section => <PersonalSection key={section.id} section={section} t={t} />)}
          {!!data.previousAnswers?.length && <details className="fit-report"><summary>{t("回看旧版答案（仅自己可见）", "Past answers (only you)", "Respuestas anteriores (solo tú)")}</summary>
            <p>{t("这些是按旧题保存的回答。本次解析使用新版情景的回答。", "These answers keep their original questions. Your current guide uses the new situations.", "Estas respuestas conservan sus preguntas originales. Tu guía actual usa las situaciones nuevas.")}</p>
            {data.previousAnswers.map(item => <div key={item.question}><p>{item.question}</p><blockquote>{item.answer}</blockquote></div>)}
          </details>}
          {data.personal && <button type="button" className="fit-copy" onClick={() => void copyReport()}>{t("复制我的记录", "Copy my notes", "Copiar mis notas")}</button>}
        </details>
        <button type="button" className="fit-profile-link" onClick={startProfile} disabled={busy} data-testid="fit-profile"><span><strong>{profileTitle}</strong><small>{t("补上你已经知道的自己，看看两种解读。", "Add what you already know about yourself and explore both lenses.", "Añade lo que ya conoces de ti y explora ambas miradas.")}</small></span><CaretRight size={20} /></button>
        {(Object.keys(data.profile.answers).length > 0 || !!data.previousAnswers?.length || !!data.profile.mbti || !!data.profile.zodiac) && <button type="button" className="fit-delete" disabled={busy} onClick={() => { keyboard.hide(); setSheet("delete"); }}>{t("删除我的答案与说明书", "Delete my answers and guide", "Eliminar mis respuestas y mi guía")}</button>}
      </> : data && <>
        <div className="fit-intro fit-couple-intro"><h2>{data.couple.status === "ready" ? (data.profile.shareMode === "support" ? t("我们可以怎么陪对方", "How we can be there for each other", "Cómo podemos acompañarnos") : t("我们俩的相处记录", "Our relationship notes", "Nuestras notas en pareja")) : t("从我，到我们俩", "From me to us", "De mí a nosotros")}</h2><p>{data.couple.summary}</p>
          {data.couple.status === "unpaired" ? <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>
            : data.couple.status === "need-your-share" ? <button type="button" className="fit-primary" onClick={() => { if (canShare) { openShare(); } else if (discovery?.reviewable) { setView("mine"); } else { openSupport(); } }}>{canShare ? t("预览我的分享", "Review my sharing", "Revisar lo que compartiré") : t("先看看我的发现", "Explore my discovery", "Ver mi hallazgo")}<ArrowRight size={18} /></button>
              : data.couple.status === "different-guides" ? <button type="button" className="fit-secondary" onClick={() => setView("mine")}>{t("查看我的陪伴主题", "Open my support topic", "Ver mi tema de apoyo")}</button>
              : data.couple.status === "waiting" ? <p className="fit-wait" role="status">{t(`等 ${data.couple.partnerName || "TA"} 确认分享。`, `Waiting for ${data.couple.partnerName || "your partner"} to share.`, `Falta que ${data.couple.partnerName || "tu pareja"} comparta su guía.`)}</p> : null}
        </div>
        {data.couple.status === "ready" && <>
          {data.couple.sections.map((section) => <PairSection key={section.id} section={section} partnerName={data.couple.partnerName} t={t} onDiscuss={() => { keyboard.hide(); onDiscuss(section.id.startsWith("support-") ? section.suggestion : `${section.title}\n${section.summary}\n${section.suggestion}`); }} />)}
          <button type="button" className="fit-copy" onClick={() => void copyReport(true)}>{t("复制双人摘要", "Copy our summary", "Copiar nuestro resumen")}</button>
          {data.couple.mbti && <section className="fit-report"><h2>{data.couple.mbti.title}</h2><p>{data.couple.mbti.summary}</p><TypeSource t={t} /></section>}
          {data.couple.zodiac && <section className="fit-report fit-zodiac"><h2>{data.couple.zodiac.title}</h2><p className="fit-fine">{t("星座趣味解读", "Zodiac, just for fun", "Los signos, por diversión")}</p><p>{data.couple.zodiac.summary}</p></section>}
          <button className="fit-profile-link" type="button" onClick={startProfile}><span>{profileTitle}</span><CaretRight size={20} /></button>
        </>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw-couple">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>}
      </>}
      {!!copyStatus && <p className="fit-notice" role="status">{copyStatus}</p>}
    </div></MobileScroll></div>
    <BottomSheet open={sheet === "share"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("分享前看一眼", "Review before sharing", "Revisar antes de compartir")} snap={0.89}>
      <div className="fit-sheet">
        <button type="button" className="fit-sheet-close" onClick={closeSheet} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
        {data?.profile.shareMode === "support" && <section className="fit-report"><h2>{support?.title}</h2>
          {data.supportSharePreview.map((line, i) => <p key={i}>{line}</p>)}
          <p className="fit-fine">{t("双方确认后，TA 会看到上面的说法和据此整理的双人解析。完整答题记录留在你的个人页。", "Once you both agree, your partner can see the statements above and the insights drawn from them. The full answer history stays on your own page.", "Cuando ambos acepten, tu pareja verá las frases de arriba y las reflexiones que surjan de ellas. El historial completo de respuestas se queda en tu página personal.")}</p>
        </section>}
        {data?.profile.shareMode === "legacy" && <>
          <p>{t("双方确认后，你们共同答过的旧主题会显示各自选择，也会对照双方都填过的类型资料。", "Once both of you agree, shared legacy topics can show both answers. Type information can be compared when both of you have added it.", "Cuando ambos acepten, los temas anteriores en común podrán mostrar las dos respuestas. Los tipos que ambos indicaron también se podrán comparar.")}</p>
          {notes.map(section => <PersonalSection key={section.id} section={section} t={t} expanded />)}
        </>}
        <p className="fit-fine">{t("确认后，「我们俩」里会出现一条邀请。", "Confirming adds an invitation to your shared chat.", "Al confirmar, se enviará una invitación a su chat.")}</p>
        {sheet === "share" && sheetVersion !== data?.profile.version && <p role="alert" className="fit-error">{t("内容刚有更新。请关闭后重新预览。", "This has changed. Close and open the preview again.", "El contenido cambió. Cierra y vuelve a abrir la vista previa.")}</p>}
        <button type="button" className="fit-primary" disabled={busy || !online || !canShare || sheetVersion !== data?.profile.version || (data?.profile.shareMode === "support" && !data.supportSharePreview.length)} onClick={async () => { if (data && sheetVersion === data.profile.version && await mutate("sharing", { on: true, mode: data.profile.shareMode })) { closeSheet(); setView("couple"); } }} data-testid="fit-confirm-share">{busy ? t("分享中…", "Sharing…", "Compartiendo…") : t("确认分享这个版本", "Share this version", "Compartir esta versión")}</button>
        <button type="button" className="fit-secondary" disabled={busy} onClick={closeSheet}>{t("先留给自己", "Keep it private for now", "De momento, solo para mí")}</button>
        {error && <p className="fit-error" role="alert">{error}</p>}
      </div>
    </BottomSheet>
    <BottomSheet open={sheet === "edit"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("用我自己的话说", "In my own words", "Con mis palabras")} snap={0.62}>
      <form className="fit-sheet" onSubmit={async event => { event.preventDefault(); if (data && sheetVersion === data.profile.version && await saveReview("edit", wording.trim())) closeSheet(); }}>
        <label>{t("我心情不好时，希望你……", "When I’m having a hard time, I’d like you to…", "Cuando lo paso mal, me gustaría que…")}
          <KeyboardTextarea rows={4} maxLength={400} value={wording} disabled={busy} onChange={event => setWording(event.target.value)} onBlur={() => keyboard.hide()} />
        </label>
        {sheet === "edit" && sheetVersion !== data?.profile.version && <p role="alert" className="fit-error">{t("你的记录刚有更新。请重新打开编辑。", "Your notes changed. Reopen the editor to use the latest wording.", "Tus notas cambiaron. Vuelve a abrir el editor para ver la versión actual.")}</p>}
        <button type="submit" className="fit-primary" disabled={busy || !online || !wording.trim() || sheetVersion !== data?.profile.version}>{t("保存我的说法", "Save my wording", "Guardar mis palabras")}</button>
        <button type="button" className="fit-secondary" disabled={busy} onClick={closeSheet}>{t("取消", "Cancel", "Cancelar")}</button>
        {error && <p className="fit-error" role="alert">{error}</p>}
      </form>
    </BottomSheet>
    <BottomSheet open={sheet === "profile"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={profileTitle} snap={0.62}>
      <form className="fit-sheet" onSubmit={async (event) => { event.preventDefault(); if (await mutate("profile", { mbti: profileDraft.mbti || null, zodiac: profileDraft.zodiac || null })) closeSheet(); }}>
        <button type="button" className="fit-sheet-close" onClick={closeSheet} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
        <label>MBTI<select value={profileDraft.mbti} disabled={busy} onChange={(event) => setProfileDraft((draft) => ({ ...draft, mbti: event.target.value }))} data-testid="fit-mbti"><option value="">{t("还不知道 / 暂不填写", "I don't know / leave blank", "No lo sé / dejar vacío")}</option>{mbtiTypes.map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
        <p className="fit-fine">{t("填写你自己测过的类型。Pinky 根据情景回答整理相处方式。", "Add a type you've already explored. Your guide uses your situation answers to describe how you relate.", "Añade un tipo que ya conozcas. La guía usa tus respuestas para describir cómo te relacionas.")}</p>
        <label>{t("星座", "Zodiac sign", "Signo zodiacal")}<select value={profileDraft.zodiac} disabled={busy} onChange={(event) => setProfileDraft((draft) => ({ ...draft, zodiac: event.target.value }))} data-testid="fit-zodiac"><option value="">{t("暂不填写", "Leave blank", "Dejar vacío")}</option>{zodiacNames.map(([id, zh, en, es]) => <option value={id} key={id}>{t(zh, en, es)}</option>)}</select></label>
        <p className="fit-fine">{t("星座用于趣味解读。双人相处解析依据你们实际选择的答案。", "Zodiac readings are for fun. Your connection insights come from the answers you actually choose.", "Los signos son una lectura divertida. Las reflexiones de pareja se basan en las respuestas que eligen.")}</p>
        {data?.profile.sharing && <p className="fit-fine">{t("修改后需要重新确认分享。", "After editing, review and share your guide again.", "Después de editar, revisa y comparte tu guía de nuevo.")}</p>}
        <button className="fit-primary" type="submit" disabled={busy || !online}>{busy ? t("保存中…", "Saving…", "Guardando…") : t("保存", "Save", "Guardar")}</button>
        {error && <p className="fit-error" role="alert">{error}</p>}
      </form>
    </BottomSheet>
    <BottomSheet open={sheet === "delete"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("删除这份说明书？", "Delete your guide?", "¿Eliminar tu guía?")} snap={0.44}>
      <div className="fit-sheet"><p>{t("你的情景答案、MBTI、星座和分享许可会一起删除。双人解析也会关闭，之后可以重新开始。", "This deletes your answers, MBTI, zodiac and sharing permission. Your connection guide closes too. You can start again later.", "Se eliminarán tus respuestas, MBTI, signo y permiso para compartir. La guía de ambos también se cerrará. Puedes volver a empezar después.")}</p>
        <button type="button" className="fit-primary" disabled={busy || !online} onClick={async () => { if (await mutate("", {}, true)) { closeSheet(); finish(); setView("mine"); } }} data-testid="fit-delete-confirm">{busy ? t("删除中…", "Deleting…", "Eliminando…") : t("删除我的说明书", "Delete my guide", "Eliminar mi guía")}</button>
        <button className="fit-secondary" type="button" disabled={busy} onClick={closeSheet}>{t("保留", "Keep it", "Conservarla")}</button>{error && <p className="fit-error" role="alert">{error}</p>}
      </div>
    </BottomSheet>
  </section>;
}

function Evidence({ section, t, expanded = false }: { section: FitSection; t: Translate; expanded?: boolean }) {
  if (!section.evidence.length) return null;
  return <details className="fit-basis" open={expanded || undefined}><summary>{t("看看依据", "See what this is based on", "Ver en qué se basa")}<CaretRight size={15} /></summary>
    <div className="fit-evidence">{section.evidence.map(item => <div key={item.questionId}><p>{item.question}</p><blockquote>{item.answer}</blockquote></div>)}</div>
  </details>;
}

function PersonalSection({ section, t, expanded = false }: { section: FitSection; t: Translate; expanded?: boolean }) {
  return <section className="fit-report" data-testid={`fit-report-${section.id}`}><h2>{section.title}</h2><p>{section.summary}</p>
    <Evidence section={section} t={t} expanded={expanded} />
    <p className="fit-suggestion">{section.suggestion}</p>{section.id === "mbti" && <TypeSource t={t} />}</section>;
}

function PairSection({ section, partnerName, t, onDiscuss }: { section: FitPairSection; partnerName: string; t: Translate; onDiscuss: () => void }) {
  const status = section.status === "same" ? t("这里想到一起了", "On the same page", "Aquí coinciden") : section.status === "mixed" ? t("有共鸣，也有不同", "Some shared ground, some differences", "Coincidencias y diferencias") : section.status === "different" ? t("值得聊聊的不同", "A difference to talk about", "Una diferencia para conversar") : t("还可以多了解一点", "More to discover", "Queda por descubrir");
  return <section className={`fit-report fit-pair-${section.status}`} data-testid={`fit-couple-${section.id}`}><h2>{section.title}</h2>{!section.id.startsWith("support-") && <p className="fit-status">{status}</p>}<p>{section.summary}</p>
    {!!section.evidence.length && <details><summary>{t("看看双方的答案", "See both answers", "Ver las dos respuestas")}<CaretRight size={15} /></summary><div className="fit-evidence">{section.evidence.map((item) => <div key={item.questionId}><p>{item.question}</p><dl><dt>{t("你", "You", "Tú")}</dt><dd>{item.mine}</dd><dt>{partnerName}</dt><dd>{item.partner}</dd></dl></div>)}</div></details>}
    <p className="fit-suggestion">{section.suggestion}</p>{section.status !== "unknown" && <button className="fit-discuss" type="button" onClick={onDiscuss}>{t("带回我们俩聊聊", "Talk about this in Us", "Llevarlo al chat")}<ArrowRight size={16} /></button>}</section>;
}

function TypeSource({ t }: { t: Translate }) {
  return <a className="fit-type-source" href="https://www.myersbriggs.org/my-mbti-personality-type/the-mbti-preferences/" target="_blank" rel="noopener noreferrer">{t("类型框架来源：Myers & Briggs Foundation", "Type framework: Myers & Briggs Foundation", "Marco de tipos: Myers & Briggs Foundation")}</a>;
}
