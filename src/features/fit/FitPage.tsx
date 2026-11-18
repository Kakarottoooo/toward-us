import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CaretRight, LockKey, UsersThree, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { FitPairSection, FitSection, FitState } from "./types";
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
  const flowKey = `pinky:fit-inventory-v1:${userId}`;
  const [data, setData] = useState<FitState | null>(null);
  const [view, setView] = useState<"mine" | "couple">("mine");
  const [rememberedStage, setStage] = useState(() => rememberedFlow(flowKey));
  const [index, setIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sheet, setSheet] = useState<"share" | "profile" | "delete" | null>(null);
  const [profileDraft, setProfileDraft] = useState({ mbti: "", zodiac: "" });
  const [sheetVersion, setSheetVersion] = useState<number | null>(null);
  const [previewRelationship, setPreviewRelationship] = useState<string | null>(null);
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
  const personalQuestions = data?.inventory.questions || [];
  const pairQuestions = data?.inventory.pairQuestions || [];
  const relationshipId = data?.inventory.relationshipId;
  const pairStage = relationshipId ? `pair:${relationshipId}` : "";
  const inPairStage = !!pairStage && rememberedStage === pairStage && pairQuestions.length > 0 && !!data?.inventory.report;
  const flow = rememberedStage === "open" || inPairStage;
  const questions = inPairStage ? pairQuestions : personalQuestions;
  const pairSeen = pairQuestions.filter(q => data?.profile.answers[q.id]).length;
  const report = data?.inventory.report;
  const firstMissing = questions.findIndex(q => !data?.profile.answers[q.id]);
  const revisit = questions.findIndex(q => data?.inventory.revisitIds.includes(q.id));
  const seen = questions.filter(q => data?.profile.answers[q.id]).length;
  const currentIndex = index ?? (firstMissing >= 0 ? firstMissing : Math.max(0, revisit));
  const question = flow && questions[currentIndex];
  const selected = question ? data?.profile.answers[question.id] : undefined;
  const canShare = data?.profile.shareMode === "pattern-v2" && data.inventory.preview.length > 0 && !!data.inventory.relationshipId;
  const setQuestionFlow = (stage: string) => {
    keyboard.hide(); setStage(stage); setIndex(null); setError(""); setCopyStatus("");
    try { if (stage) localStorage.setItem(flowKey, stage); else localStorage.removeItem(flowKey); } catch { /* Resume from saved answers. */ }
  };
  const finish = () => { setQuestionFlow(""); setView("mine"); };
  useEffect(() => { const scroll = contentRef.current?.closest<HTMLElement>(".mobile-scroll"); if (scroll) scroll.scrollTop = 0; }, [flow, currentIndex, view]);
  const mutate = async (path: string, body: Record<string, unknown> = {}, remove = false) => {
    if (!data || writes.current || !online) return false;
    writes.current = true; request.current++; setBusy(true); setError(""); keyboard.hide();
    try {
      const next = await relationshipApi<FitState>(remove ? `/api/fit?version=${data.profile.version}&language=${language}` : `/api/fit/${path}`,
        remove ? { method: "DELETE" } : jsonBody({ version: data.profile.version, language, ...body }));
      setData(next);
      return next;
    } catch (caught) {
      setError((caught as Error).message);
      if ((caught as { status?: number }).status === 409) refreshAfterWrite.current = true;
      return false;
    } finally {
      writes.current = false; setBusy(false);
      if (refreshAfterWrite.current) { refreshAfterWrite.current = false; void load(); }
    }
  };
  const nextQuestion = async (answer: string) => {
    if (!question || writes.current) return;
    const updated = answer === selected ? data : await mutate("answers", {
      answers: { [question.id]: answer }, ...(inPairStage ? { relationshipId } : {}),
    });
    if (!updated) return;
    const pending = questions.filter(q => !updated.profile.answers[q.id]);
    if (pending.length) {
      const nextMissing = questions.findIndex((q, i) => i > currentIndex && !updated.profile.answers[q.id]);
      setIndex(nextMissing >= 0 ? nextMissing : questions.indexOf(pending[0]));
    } else if (!inPairStage && seen === questions.length && !updated.inventory.report && updated.inventory.revisitIds.some(id => id !== question.id)) {
      const nextRevisit = questions.findIndex((q, i) => i > currentIndex && updated.inventory.revisitIds.includes(q.id));
      setIndex(nextRevisit >= 0 ? nextRevisit : questions.findIndex(q => q.id !== question.id && updated.inventory.revisitIds.includes(q.id)));
    } else finish();
  };
  const nextStage = report && pairQuestions.length ? pairStage : "open";
  const pairStageLabel = pairSeen === pairQuestions.length
    ? t("回看双人场景", "Review shared-life questions", "Revisar situaciones de pareja")
    : pairSeen ? t("继续双人场景", "Continue shared-life questions", "Continuar las situaciones de pareja")
    : t("填写双人场景", "Answer shared-life questions", "Responder sobre nuestra relación");
  const closeSheet = () => { keyboard.hide(); setSheet(null); };
  const title = t("我们有多合拍", "How we connect", "Así conectamos");
  const profileTitle = t("MBTI 与星座", "MBTI & zodiac", "MBTI y signo");
  const archive = data?.personal?.sections || [];
  const openShare = () => {
    if (!data || !canShare) return;
    keyboard.hide(); setSheetVersion(data.profile.version);
    setPreviewRelationship(data.inventory.relationshipId); setSheet("share");
  };
  const previewCurrent = !!canShare && sheetVersion === data?.profile.version && previewRelationship === data?.inventory.relationshipId;
  const startProfile = () => { keyboard.hide(); setProfileDraft({ mbti: data?.profile.mbti || "", zodiac: data?.profile.zodiac || "" }); setSheet("profile"); };
  const goBack = () => { keyboard.hide(); if (flow) finish(); else onBack(); };
  const copyReport = async (couple = false) => {
    if (!data) return;
    const sections = couple ? data.couple.sections : report?.sections || [];
    const summary = couple ? data.couple.summary : report?.summary || "";
    const reportTitle = couple ? data.couple.title || title : report?.title || t("我的关系说明书", "My relationship guide", "Mi guía de relación");
    const text = [reportTitle, summary, ...sections.map((section) => `${section.title}\n${section.summary}\n${section.suggestion}`),
      t("根据本人选择的情景回答整理 · Pinky", "Based on self-reported situation answers · Pinky", "Basado en respuestas personales a situaciones · Pinky")].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(t("解析已复制，可以保存或分享。", "Guide copied. You can save or share it.", "Guía copiada. Puedes guardarla o compartirla."));
    } catch { setCopyStatus(t("暂时无法复制，请稍后再试。", "Couldn't copy right now. Please try again.", "No se pudo copiar. Inténtalo de nuevo.")); }
  };

  return <section className="fit-page paper-screen" data-testid="fit-page">
    <header className="fit-header">
      <button type="button" disabled={busy} onClick={goBack} aria-label={flow ? t("回到说明书", "Back to your guide", "Volver a tu guía") : t("回到对话", "Back to chat", "Volver al chat")} data-testid="fit-back"><ArrowLeft size={22} /></button>
      <h1>{title}</h1><span aria-hidden="true" />
    </header>
    {!flow && <div className="fit-tabs" role="tablist" aria-label={title}>
      <button type="button" role="tab" aria-selected={view === "mine"} onClick={() => { keyboard.hide(); setView("mine"); }}><LockKey size={17} />{t("我的画像", "My portrait", "Mi retrato")}</button>
      <button type="button" role="tab" aria-selected={view === "couple"} onClick={() => { keyboard.hide(); setView("couple"); }}><UsersThree size={18} />{t("我们俩的解析", "Our connection", "Nuestra conexión")}</button>
    </div>}
    <div className="fit-scroll"><MobileScroll><div className="fit-content" ref={contentRef}>
      {!online && <p className="fit-notice" role="status">{t("你现在离线，已打开的说明书可以继续看。联网后再保存。", "You're offline. You can read this guide; reconnect to save changes.", "Estás sin conexión. Puedes leer tu guía; vuelve a conectarte para guardar cambios.")}</p>}
      {error && <div className="fit-error" role="alert"><p>{error}</p><button type="button" disabled={busy || !online} onClick={() => { setError(""); void load(); }}>{t("重新加载", "Reload", "Volver a cargar")}</button></div>}
      {loading && !data && <p className="fit-notice" role="status">{t("正在打开说明书…", "Opening your guide…", "Abriendo tu guía…")}</p>}
      {question && data ? <div className="fit-question">
        <div className="fit-question-progress"><label htmlFor="fit-position">{inPairStage ? t("双人场景", "Shared life", "En pareja") : t("个人场景", "Your portrait", "Mi retrato")} {currentIndex + 1} / {questions.length}</label>
          <span aria-live="polite">{busy ? t("保存中…", "Saving…", "Guardando…") : t(`已记录 ${seen} 题`, `${seen} saved`, `${seen} guardadas`)}</span></div>
        <input id="fit-position" data-scroll-drag="ignore" className="fit-position" type="range" min={1} max={questions.length} value={currentIndex + 1} disabled={busy}
          aria-label={t("跳到第几题", "Jump to question", "Ir a la pregunta")} onChange={e => setIndex(Number(e.target.value) - 1)} />
        <h2>{question.text}</h2>
        <div className="fit-options" role="group" aria-label={t("选择最接近你的反应", "Choose what sounds most like you", "Elige lo que más se parezca a ti")}>
          {question.options.map((option) => <button type="button" key={option.id} aria-pressed={selected === option.id} disabled={busy || !online} onClick={() => void nextQuestion(option.id)} data-testid="fit-option">
            <span>{option.text}</span><i aria-hidden="true">{selected === option.id && <Check size={15} weight="bold" />}</i>
          </button>)}
        </div>
        <button type="button" className="fit-copy" disabled={busy || !online} onClick={() => void nextQuestion("skip")} data-testid="fit-skip">{t("都不像 / 想不起来，跳过", "None fit or I can't recall. Skip", "Ninguna encaja o no lo recuerdo. Saltar")}</button>
        {data.profile.sharing && <p className="fit-fine">{t("修改后，重新确认分享才会更新双人解析。", "After an edit, review and share again to update your connection guide.", "Después de editar, revisa y comparte de nuevo para actualizar la guía de ambos.")}</p>}
        {currentIndex > 0 && <div className="fit-actions"><button type="button" className="fit-secondary" disabled={busy} onClick={() => setIndex(currentIndex - 1)}>{t("上一题", "Previous question", "Pregunta anterior")}</button></div>}
      </div> : data && view === "mine" ? <>
        <section className="fit-intro fit-portrait">
          <h2>{report?.title || t("恋爱里的我，是什么样？", "What am I like in a relationship?", "¿Cómo soy en pareja?")}</h2>
          {!!report?.markers?.length && <ul className="fit-markers">{report.markers.map(marker => <li key={marker}>{marker}</li>)}</ul>}
          <p>{report?.summary || (seen === questions.length ? t("有些方面还缺少线索。可以从跳过的场景补答，也可以以后再来。", "A few areas need more detail. Revisit a skipped situation now or come back later.", "Faltan pistas en algunos aspectos. Puedes retomar una situación omitida ahora o volver después.")
            : t("想想最近一次类似的经历，选更接近当时发生的事。想不起来可以跳过。答完会看到自己的相处画像，具体答案只有你能看。", "Think of the last time something similar happened. Pick the closest memory, or skip it. Your choices shape your portrait and stay private.", "Piensa en la última vez que pasó algo parecido. Elige lo que más se acerque a tu recuerdo, o salta la pregunta. Tus respuestas forman tu retrato y son privadas."))}</p>
          {report ? <p className="fit-fine">{report.coverage}</p> : <p className="fit-fine">{seen ? t(`已记录 ${seen} / ${questions.length} 题`, `${seen} of ${questions.length} saved`, `${seen} de ${questions.length} guardadas`) : t(`${questions.length} 道情境题 · 可以分几次答`, `${questions.length} situations · Pause anytime`, `${questions.length} situaciones · A tu ritmo`)}</p>}
          <button className={report ? "fit-secondary" : "fit-primary"} type="button" disabled={busy || !questions.length} onClick={() => setQuestionFlow("open")} data-testid="fit-start">
            {report ? t("回看或修改答案", "Review or edit answers", "Revisar o editar respuestas") : seen === questions.length ? t("补答跳过的场景", "Revisit skipped situations", "Retomar situaciones omitidas") : seen ? t("继续答题", "Continue", "Continuar") : t("开始答题", "Start", "Empezar")}<ArrowRight size={17} />
          </button>
        </section>
        {report && <><section className="fit-sharing">
          {pairStage && pairQuestions.length > 0 ? <>
            <h3>{t("我们怎样相处", "How we relate", "Cómo nos relacionamos")}</h3>
            <p>{t("回想与当前伴侣的经历，看看日常亲近、对外支持和分歧后的修复。", "Think about everyday closeness, outside stress and reconnecting after disagreements with your current partner.", "Piensa en la cercanía diaria, el apoyo ante el estrés y cómo retoman el diálogo después de un desacuerdo con tu pareja actual.")}</p>
            <p className="fit-fine">{t(`已记录 ${pairSeen} / ${pairQuestions.length} 个双人场景`, `${pairSeen} of ${pairQuestions.length} shared-life questions saved`, `${pairSeen} de ${pairQuestions.length} situaciones de pareja guardadas`)}</p>
            {pairSeen === pairQuestions.length && !canShare && <p className="fit-fine">{t("还没有足够线索生成可分享的摘要。回看双人场景，补上你记得的经历。", "There is not enough information for a shareable summary yet. Revisit these questions to add an experience you remember.", "Aún faltan pistas para preparar un resumen. Vuelve a las situaciones y añade alguna experiencia que recuerdes.")}</p>}
            {canShare && !data.profile.sharing && <button type="button" className="fit-primary" disabled={busy || !online} onClick={openShare}>{t("预览并分享给 TA", "Preview and share", "Revisar y compartir")}<ArrowRight size={18}/></button>}
            {canShare && data.profile.sharing && <p className="fit-fine">{t("你已分享这版双人摘要。", "You have shared this version of your summary.", "Ya compartiste esta versión de tu resumen.")}</p>}
            <button type="button" className={canShare ? "fit-secondary" : "fit-primary"} disabled={busy} onClick={() => setQuestionFlow(pairStage)}>{pairStageLabel}<ArrowRight size={17}/></button>
          </> : !relationshipId && <button type="button" className="fit-secondary" onClick={onInvite}>{t("邀请 TA 一起做", "Invite your partner", "Invitar a mi pareja")}</button>}
        </section>{report.sections.map(section => <PersonalSection key={section.id} section={section} t={t} />)}
          <button type="button" className="fit-copy" onClick={() => void copyReport()}>{t("复制我的画像", "Copy my portrait", "Copiar mi retrato")}</button></>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })}>{t("撤回我的分享", "Withdraw sharing", "Retirar mi permiso")}</button>}
        <details className="fit-other">
          <summary>{t("我的历史记录与类型资料", "My past notes and type information", "Mis notas anteriores y datos de tipo")}<CaretRight size={17}/></summary>
          {archive.map(section => <PersonalSection key={section.id} section={section} t={t} />)}
          {!!data.previousAnswers?.length && <div className="fit-evidence">{data.previousAnswers.map(item => <div key={item.question}><p>{item.question}</p><blockquote>{item.answer}</blockquote></div>)}</div>}
          <button type="button" className="fit-profile-link" onClick={startProfile} disabled={busy}><strong>{profileTitle}</strong><CaretRight size={20} /></button>
        </details>
        {(Object.keys(data.profile.answers).length > 0 || !!data.previousAnswers?.length || !!data.profile.mbti || !!data.profile.zodiac) && <button type="button" className="fit-delete" disabled={busy || !online} onClick={() => { keyboard.hide(); setSheet("delete"); }}>{t("删除我的答案与说明书", "Delete my answers and guide", "Eliminar mis respuestas y mi guía")}</button>}
      </> : data && <>
        <div className="fit-intro fit-couple-intro"><h2>{data.couple.status === "ready" ? data.couple.title || (data.profile.shareMode === "support" ? t("我们可以怎么陪对方", "How we can be there for each other", "Cómo podemos acompañarnos") : t("我们俩的相处记录", "Our relationship notes", "Nuestras notas en pareja")) : t("从我，到我们俩", "From me to us", "De mí a nosotros")}</h2><p>{data.couple.summary}</p>
          {data.couple.status === "unpaired" ? <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>
            : data.couple.status === "need-your-share" ? <button type="button" className="fit-primary" onClick={() => { if (canShare) openShare(); else { setView("mine"); setQuestionFlow(nextStage); } }}>{canShare ? t("预览我的分享", "Review my sharing", "Revisar lo que compartiré") : nextStage !== "open" ? pairStageLabel : t("填写个人场景", "Start my portrait", "Empezar mi retrato")}<ArrowRight size={18} /></button>
              : data.couple.status === "different-guides" ? <button type="button" className="fit-secondary" onClick={() => setView("mine")}>{t("查看我的画像", "View my portrait", "Ver mi retrato")}</button>
              : data.couple.status === "waiting" ? <p className="fit-wait" role="status">{t(`等 ${data.couple.partnerName || "TA"} 确认分享。`, `Waiting for ${data.couple.partnerName || "your partner"} to share.`, `Falta que ${data.couple.partnerName || "tu pareja"} comparta su guía.`)}</p> : null}
        </div>
        {data.profile.sharing && data.profile.shareMode !== "pattern-v2" && (data.couple.status === "ready" || data.couple.status === "waiting") && <button type="button" className="fit-secondary" disabled={busy} onClick={() => { setView("mine"); setQuestionFlow(nextStage); }}>{t("完善新版合拍组合", "Explore our relationship pattern", "Explorar nuestro patrón de pareja")}</button>}
        {data.couple.status === "ready" && <>
          {data.couple.sections.map((section) => <PairSection key={section.id} section={section} pattern={data.profile.shareMode === "pattern-v2"} partnerName={data.couple.partnerName} t={t} onDiscuss={() => { keyboard.hide(); onDiscuss(section.id.startsWith("support-") ? section.suggestion : `${section.title}\n${section.summary}\n${section.suggestion}`); }} />)}
          <button type="button" className="fit-copy" onClick={() => void copyReport(true)}>{t("复制双人摘要", "Copy our summary", "Copiar nuestro resumen")}</button>
          {data.couple.mbti && <section className="fit-report"><h2>{data.couple.mbti.title}</h2><p>{data.couple.mbti.summary}</p><TypeSource t={t} /></section>}
          {data.couple.zodiac && <section className="fit-report fit-zodiac"><h2>{data.couple.zodiac.title}</h2><p className="fit-fine">{t("星座趣味解读", "Zodiac, just for fun", "Los signos, por diversión")}</p><p>{data.couple.zodiac.summary}</p></section>}
          {data.profile.shareMode !== "inventory" && data.profile.shareMode !== "pattern-v2" && <button className="fit-profile-link" type="button" onClick={startProfile}><span>{profileTitle}</span><CaretRight size={20} /></button>}
        </>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw-couple">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>}
      </>}
      {!!copyStatus && <p className="fit-notice" role="status">{copyStatus}</p>}
    </div></MobileScroll></div>
    <BottomSheet open={sheet === "share"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("分享前看一眼", "Review before sharing", "Revisar antes de compartir")} snap={0.89}>
      <div className="fit-sheet">
        <button type="button" className="fit-sheet-close" onClick={closeSheet} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
        {canShare && <section className="fit-report"><h2>{t("TA 能看到的摘要", "What your partner can see", "Lo que verá tu pareja")}</h2>
          {data?.inventory.preview.map((line,i) => <p key={i}>{line}</p>)}
          <p className="fit-fine">{t("双方都分享后，Pinky 会用各自批准的摘要解释组合与方向差异。逐题答案仅自己可见。", "Once both of you share, Pinky uses your approved summaries to explain your pattern in each direction. Individual answers stay private.", "Cuando ambos compartan, Pinky usará los dos resúmenes aprobados para explicar su patrón en ambas direcciones. Las respuestas individuales son privadas.")}</p></section>}
        <p className="fit-fine">{t("确认后，「我们俩」里会出现一条邀请。", "Confirming adds an invitation to your shared chat.", "Al confirmar, se enviará una invitación a su chat.")}</p>
        {sheet === "share" && !previewCurrent && <p role="alert" className="fit-error">{t("内容刚有更新。请关闭后重新预览。", "This has changed. Close and open the preview again.", "El contenido cambió. Cierra y vuelve a abrir la vista previa.")}</p>}
        <button type="button" className="fit-primary" disabled={busy || !online || !previewCurrent} onClick={async () => { if (previewCurrent && await mutate("sharing", { on: true, mode: "pattern-v2", relationshipId: previewRelationship })) { closeSheet(); setView("couple"); } }} data-testid="fit-confirm-share">{busy ? t("分享中…", "Sharing…", "Compartiendo…") : t("确认分享这个版本", "Share this version", "Compartir esta versión")}</button>
        <button type="button" className="fit-secondary" disabled={busy} onClick={closeSheet}>{t("先留给自己", "Keep it private for now", "De momento, solo para mí")}</button>
        {error && <p className="fit-error" role="alert">{error}</p>}
      </div>
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

function PairSection({ section, pattern, partnerName, t, onDiscuss }: { section: FitPairSection; pattern: boolean; partnerName: string; t: Translate; onDiscuss: () => void }) {
  const status = section.status === "same" ? t("这里想到一起了", "On the same page", "Aquí coinciden") : section.status === "mixed" ? t("可以按情境聊聊", "Discuss it in context", "Conviene hablar del contexto") : section.status === "different" ? t("值得聊聊的不同", "A difference to talk about", "Una diferencia para conversar") : t("还可以多了解一点", "More to discover", "Queda por descubrir");
  return <section className={`fit-report fit-pair-${section.status}`} data-testid={`fit-couple-${section.id}`}><h2>{section.title}</h2>{!pattern && !section.id.startsWith("support-") && <p className="fit-status">{status}</p>}<p>{section.summary}</p>
    {!!section.evidence.length && <details><summary>{t("看看双方同意分享的依据", "See the details you both shared", "Ver los detalles que ambos compartieron")}<CaretRight size={15} /></summary><div className="fit-evidence">{section.evidence.map((item) => <div key={item.questionId}><p>{item.question}</p><dl><dt>{t("你", "You", "Tú")}</dt><dd>{item.mine}</dd><dt>{partnerName}</dt><dd>{item.partner}</dd></dl></div>)}</div></details>}
    <p className="fit-suggestion">{section.suggestion}</p>{section.status !== "unknown" && <button className="fit-discuss" type="button" onClick={onDiscuss}>{t("带回我们俩聊聊", "Talk about this in Us", "Llevarlo al chat")}<ArrowRight size={16} /></button>}</section>;
}

function TypeSource({ t }: { t: Translate }) {
  return <a className="fit-type-source" href="https://www.myersbriggs.org/my-mbti-personality-type/the-mbti-preferences/" target="_blank" rel="noopener noreferrer">{t("类型框架来源：Myers & Briggs Foundation", "Type framework: Myers & Briggs Foundation", "Marco de tipos: Myers & Briggs Foundation")}</a>;
}
