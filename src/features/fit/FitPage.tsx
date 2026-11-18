import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CaretRight, LockKey, UsersThree, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { FitPairSection, FitSection, FitState } from "./types";
import "./fit.css";

type Props = {
  initialView: "mine" | "couple";
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

export function FitPage({ initialView, language, userId, paired, onBack, onInvite, onDiscuss }: Props) {
  const t: Translate = (zh, en, es) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const flowKey = `pinky:fit-inventory-v1:${userId}`;
  const [data, setData] = useState<FitState | null>(null);
  const [view, setView] = useState<"mine" | "couple">(initialView);
  const [resumeFlow, setFlow] = useState(() => initialView === "mine" && rememberedFlow(flowKey) === "open");
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
  }, [load, paired]);
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
  const questions = data?.inventory.questions || [];
  const relationshipId = data?.inventory.relationshipId;
  const report = data?.inventory.report;
  const upgrading = !!data?.inventory.previousLocked;
  const submitted = data?.inventory.submitted || !!report;
  const flow = resumeFlow && !submitted;
  const firstMissing = questions.findIndex(q => !data?.profile.answers[q.id]);
  const seen = questions.filter(q => data?.profile.answers[q.id]).length;
  const currentIndex = index ?? Math.max(0, firstMissing);
  const question = flow && questions[currentIndex];
  const selected = question ? data?.profile.answers[question.id] : undefined;
  const canShare = data?.profile.shareMode === "love-v4" && data.inventory.preview.length > 0 && !!data.inventory.relationshipId;
  const setQuestionFlow = (active: boolean) => {
    keyboard.hide(); setFlow(active); setIndex(null); setError(""); setCopyStatus("");
    try { if (active) localStorage.setItem(flowKey, "open"); else localStorage.removeItem(flowKey); } catch { /* Resume from saved answers. */ }
  };
  const finish = () => { setQuestionFlow(false); setView("mine"); };
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
      answers: { [question.id]: answer },
    });
    if (!updated) return;
    if (updated.inventory.submitted) { finish(); return; }
    const pending = questions.filter(q => !updated.profile.answers[q.id]);
    if (pending.length) {
      const nextMissing = questions.findIndex((q, i) => i > currentIndex && !updated.profile.answers[q.id]);
      setIndex(nextMissing >= 0 ? nextMissing : questions.indexOf(pending[0]));
    } else finish();
  };
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
    const sections = data.couple.sections;
    const summary = couple ? data.couple.summary : report?.summary || "";
    const reportTitle = couple ? data.couple.title || title : report?.title || t("我的关系说明书", "My relationship guide", "Mi guía de relación");
    const text = couple ? [reportTitle, summary, data.couple.nextStep, data.couple.introduction, ...sections.map((section) => `${section.title}\n${section.summary}\n${section.suggestion}`),
      t("根据本人选择的情景回答整理 · Pinky", "Based on self-reported situation answers · Pinky", "Basado en respuestas personales a situaciones · Pinky")].filter(Boolean).join("\n\n") : [
      [report?.typeCode, reportTitle].filter(Boolean).join(" · "), ...(report?.legend || []), summary,
      ...(report?.chapters || []).map(chapter => chapter.title + "\n" + chapter.body), report?.introduction,
    ].filter(Boolean).join("\n\n");
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
        <div className="fit-question-progress"><label htmlFor="fit-position">{upgrading ? t("补充场景", "Additional situations", "Situaciones adicionales") : t("个人场景", "Your portrait", "Mi retrato")} {currentIndex + 1} / {questions.length}</label>
          <span aria-live="polite">{busy ? t("保存中…", "Saving…", "Guardando…") : t(`已记录 ${seen} 题`, `${seen} saved`, `${seen} guardadas`)}</span></div>
        <input id="fit-position" data-scroll-drag="ignore" className="fit-position" type="range" min={1} max={questions.length} value={currentIndex + 1} disabled={busy}
          aria-label={t("跳到第几题", "Jump to question", "Ir a la pregunta")} onChange={e => setIndex(Number(e.target.value) - 1)} />
        <h2>{question.text}</h2>
        {seen === questions.length - 1 && !selected && <p className="fit-fine">{t("这是最后一个未答场景。选择或跳过后，本次作答即完成并锁定。", "This is the last unanswered situation. Choosing or skipping finishes and locks your answers.", "Esta es la última situación pendiente. Al responderla u omitirla se cierra el cuestionario.")}</p>}
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
          {report?.typeCode && <div className="fit-type-code">{report.typeCode}</div>}
          <h2>{(report?.typeCode ? t(`你是「${report.title}」`, `Your style: ${report.title}`, `Tu estilo: ${report.title}`) : report?.title) || (submitted ? t("这次没有形成画像", "No portrait this time", "Esta vez no hay retrato") : t("我的恋爱风格", "My romantic style", "Mi estilo en pareja"))}</h2>
          {!!report?.legend?.length && <ul className="fit-markers">{report.legend.map(line => <li key={line}>{line}</li>)}</ul>}
          <p>{report?.summary || (submitted
            ? t("这次跳过了全部场景，现有信息不足以判断你的相处风格。", "You skipped every situation, so there is too little information to describe your style.", "Omitiste todas las situaciones. Falta información para describir tu estilo.")
            : upgrading ? t("之前的 32 题已经保留。补全 12 个新场景，就能了解自己更接近 16 种恋爱风格中的哪一种。", "Your 32 previous responses are saved. Complete 12 additional situations to discover which of the 16 romantic styles fits you.", "Conservamos tus 32 respuestas anteriores. Completa 12 situaciones más para descubrir cuál de los 16 estilos se acerca al tuyo.")
            : t("按自己的经历选择，想不起来可以跳过。完成后，看看你在 16 种恋爱风格里更接近哪一种，以及怎样与你相处更舒服。最后一个场景完成后，本次作答将锁定。", "Choose what fits your experience or skip. Finish to discover which of the 16 romantic styles fits you and what helps a partner connect with you. Your answers are then final.", "Elige según tu experiencia o salta la pregunta. Al terminar verás cuál de los 16 estilos se acerca al tuyo y cómo conectar contigo. Tus respuestas quedarán cerradas."))}</p>
          {!submitted && <><p className="fit-fine">{seen ? t(`已记录 ${seen} / ${questions.length} 题`, `${seen} of ${questions.length} saved`, `${seen} de ${questions.length} guardadas`) : t(`${questions.length} 道情境题 · 可以分几次答`, `${questions.length} situations · Pause anytime`, `${questions.length} situaciones · A tu ritmo`)}</p>
            <button className="fit-primary" type="button" disabled={busy || !questions.length} onClick={() => setQuestionFlow(true)} data-testid="fit-start">
              {seen ? t("继续答题", "Continue", "Continuar") : upgrading ? t("补充 12 个场景", "Complete 12 more situations", "Completar 12 situaciones más") : t("开始答题", "Start", "Empezar")}<ArrowRight size={17} />
            </button></>}
          {report?.chapters?.map(chapter => <section key={chapter.title} className="fit-reading"><h3>{chapter.title}</h3><p>{chapter.body}</p></section>)}
          {report?.introduction && <section className="fit-reading"><h3>{t("你可以这样介绍自己", "In your own words", "Así puedes presentarte")}</h3><p>{report.introduction}</p></section>}
          {report && <details className="fit-method fit-basis"><summary>{t("这个类型怎么读", "How to read this type", "Cómo leer este tipo")}<CaretRight size={15}/></summary>
            <p>{t("四个位置依次描述日常亲近（T 常伴／S 留白）、支持伴侣（L 先听／H 先做）、面对分歧（V 边谈／Q 静思）、共同筹划（C 共议／E 摸底）。共议和摸底都会一起决定，区别在于先一起形成方向，还是先查清选项。", "The four positions describe everyday closeness, how you support a partner, how you work through disagreement, and when you bring a partner into planning. Both planning styles decide together; they differ in when they explore the options together.", "Las cuatro posiciones describen la cercanía cotidiana, el apoyo que ofreces, cómo ordenas tus ideas durante un desacuerdo y cuándo empiezas a planear en pareja. Ambos estilos deciden juntos; cambia cuándo empiezan a explorar las opciones.")}</p>
            <p>{t("每个方向参考多个生活场景，四项偏好都清楚时才取完整类型名。你希望收到的照顾、看重的承诺、分担方式和未来打算，由另外的回答决定。双人组合比较两人各自的偏好，只说明可能的相处模式。", "Each preference draws on several situations. A full style name requires four clear preferences. Support you want, commitments, responsibilities and future plans come from separate responses. A couple’s profile describes a possible pattern from both people’s preferences.", "Cada preferencia se basa en varias situaciones. Para asignar un tipo completo deben estar claras las cuatro. El apoyo que necesitas, los compromisos, las responsabilidades y los planes proceden de otras respuestas. El perfil de pareja describe un patrón posible a partir de ambas perspectivas.")}</p>
          </details>}
        </section>
        {report && <><section className="fit-sharing">
          {canShare && !data.profile.sharing && <button type="button" className="fit-primary" disabled={busy || !online} onClick={openShare}>{t("连接画像", "Connect portraits", "Conectar retratos")}<ArrowRight size={18}/></button>}
          {data.profile.sharing && <button type="button" className="fit-secondary" onClick={() => setView("couple")}>{t("查看我们俩的解析", "View our connection", "Ver nuestra conexión")}<ArrowRight size={18}/></button>}
          {!relationshipId && <button type="button" className="fit-secondary" onClick={onInvite}>{t("邀请 TA 连接画像", "Invite your partner to connect", "Invitar a mi pareja a conectar")}</button>}
        </section>
          <button type="button" className="fit-copy" onClick={() => void copyReport()}>{t("复制我的画像", "Copy my portrait", "Copiar mi retrato")}</button></>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })}>{t("撤回我的分享", "Withdraw sharing", "Retirar mi permiso")}</button>}
        <details className="fit-other">
          <summary>{submitted ? t("我的类型资料", "My type information", "Mis datos de tipo") : t("我的历史记录与类型资料", "My past notes and type information", "Mis notas anteriores y datos de tipo")}<CaretRight size={17}/></summary>
          {data.inventory.previousPortrait && <details className="fit-basis">
            <summary>{t("我之前的画像", "My earlier portrait", "Mi retrato anterior")}<CaretRight size={15} /></summary>
            <h3>{data.inventory.previousPortrait.title}</h3><p>{data.inventory.previousPortrait.summary}</p>
            {data.inventory.previousPortrait.chapters?.map(chapter => <section className="fit-reading" key={chapter.title}><h3>{chapter.title}</h3><p>{chapter.body}</p></section>)}
          </details>}
          {archive.map(section => <PersonalSection key={section.id} section={section} t={t} />)}
          {!!data.previousAnswers?.length && <div className="fit-evidence">{data.previousAnswers.map(item => <div key={item.question}><p>{item.question}</p><blockquote>{item.answer}</blockquote></div>)}</div>}
          <button type="button" className="fit-profile-link" onClick={startProfile} disabled={busy}><strong>{profileTitle}</strong><CaretRight size={20} /></button>
        </details>
        {(submitted || upgrading || Object.keys(data.profile.answers).length > 0 || !!data.previousAnswers?.length || !!data.profile.mbti || !!data.profile.zodiac) && <button type="button" className="fit-delete" disabled={busy || !online} onClick={() => { keyboard.hide(); setSheet("delete"); }}>{t("删除我的答案与说明书", "Delete my answers and guide", "Eliminar mis respuestas y mi guía")}</button>}
      </> : data && <>
        <div className="fit-intro fit-couple-intro"><h2>{data.couple.status === "ready" ? data.couple.title || (data.profile.shareMode === "support" ? t("我们可以怎么陪对方", "How we can be there for each other", "Cómo podemos acompañarnos") : t("我们俩的相处记录", "Our relationship notes", "Nuestras notas en pareja")) : t("从我，到我们俩", "From me to us", "De mí a nosotros")}</h2><p>{data.couple.summary}</p>
          {data.couple.status === "unpaired" ? <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>
            : data.couple.status === "need-your-share" && canShare ? <button type="button" className="fit-primary" disabled={busy || !online} onClick={openShare}>{t("连接画像", "Connect portraits", "Conectar retratos")}<ArrowRight size={18}/></button>
              : data.couple.status === "need-your-share" && submitted && !report ? <p className="fit-wait">{t("这次作答缺少可连接的个人画像。", "This submission did not produce a portrait to connect.", "Esta vez no se generó un retrato para conectar.")}</p>
              : data.couple.status === "need-your-share" && !report ? <p className="fit-wait">{t("在「我的画像」完成个人问卷后，就可以连接两份画像。", "Finish your questionnaire in My portrait to connect your portraits.", "Completa tu cuestionario en Mi retrato para conectar ambos retratos.")}</p>
              : data.couple.status === "waiting" ? <p className="fit-wait" role="status">{t(`等 ${data.couple.partnerName || "TA"} 连接画像，完成后这里会自动显示结果。`, `Your result will appear here when ${data.couple.partnerName || "your partner"} connects their portrait.`, `El resultado aparecerá aquí cuando ${data.couple.partnerName || "tu pareja"} conecte su retrato.`)}</p> : null}
        </div>
        {data.couple.status === "ready" && <>
          {data.profile.shareMode === "love-v4" && <dl className="fit-pair-overview">{data.couple.sections.filter(s => ["love-daily", "love-support", "love-repair"].includes(s.id)).map(s =>
            <div key={s.id}><dt>{s.title}</dt><dd>{s.status === "same" ? t("较顺畅", "Likely aligned", "Parece haber sintonía") : s.status === "different" ? t("需协调", "Worth coordinating", "Conviene acordarlo") : t("待确认", "Still open", "Por confirmar")}</dd></div>
          )}</dl>}
          {data.couple.nextStep && <section className="fit-report"><h2>{t("我们最值得先做的一件事", "One thing to do together first", "Lo primero que podemos hacer juntos")}</h2><p>{data.couple.nextStep}</p></section>}
          {data.couple.sections.map((section) => <PairSection key={section.id} section={section} pattern={data.profile.shareMode === "love-v4" || data.profile.shareMode === "pattern-v2" || data.profile.shareMode === "portrait-v3"} partnerName={data.couple.partnerName} t={t} onDiscuss={() => { keyboard.hide(); onDiscuss(section.id.startsWith("support-") ? section.suggestion : `${section.title}\n${section.summary}\n${section.suggestion}`); }} />)}
          {data.couple.introduction && <section className="fit-reading"><h3>{t("你们可以这样介绍自己", "In your own words", "Así pueden presentarse")}</h3><p>{data.couple.introduction}</p></section>}
          <button type="button" className="fit-copy" onClick={() => void copyReport(true)}>{t("复制双人摘要", "Copy our summary", "Copiar nuestro resumen")}</button>
          {data.couple.mbti && <section className="fit-report"><h2>{data.couple.mbti.title}</h2><p>{data.couple.mbti.summary}</p><TypeSource t={t} /></section>}
          {data.couple.zodiac && <section className="fit-report fit-zodiac"><h2>{data.couple.zodiac.title}</h2><p className="fit-fine">{t("星座趣味解读", "Zodiac, just for fun", "Los signos, por diversión")}</p><p>{data.couple.zodiac.summary}</p></section>}
          {(data.profile.shareMode === "legacy" || data.profile.shareMode === "support") && <button className="fit-profile-link" type="button" onClick={startProfile}><span>{profileTitle}</span><CaretRight size={20} /></button>}
        </>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw-couple">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>}
      </>}
      {!!copyStatus && <p className="fit-notice" role="status">{copyStatus}</p>}
    </div></MobileScroll></div>
    <BottomSheet open={sheet === "share"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("连接画像前看一眼", "Review before connecting", "Revisar antes de conectar")} snap={0.89}>
      <div className="fit-sheet">
        <button type="button" className="fit-sheet-close" onClick={closeSheet} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
        {canShare && <section className="fit-report"><h2>{t("TA 能看到的摘要", "What your partner can see", "Lo que verá tu pareja")}</h2>
          {data?.inventory.preview.map((line,i) => <p key={i}>{line}</p>)}
          <p className="fit-fine">{t("双方都分享后，Pinky 会用各自批准的摘要解释组合与方向差异。逐题答案仅自己可见。", "Once both of you share, Pinky uses your approved summaries to explain your pattern in each direction. Individual answers stay private.", "Cuando ambos compartan, Pinky usará los dos resúmenes aprobados para explicar su patrón en ambas direcciones. Las respuestas individuales son privadas.")}</p></section>}
        <p className="fit-fine">{t("确认后，「我们俩」里会出现一条邀请。", "Confirming adds an invitation to your shared chat.", "Al confirmar, se enviará una invitación a su chat.")}</p>
        {sheet === "share" && !previewCurrent && <p role="alert" className="fit-error">{t("内容刚有更新。请关闭后重新预览。", "This has changed. Close and open the preview again.", "El contenido cambió. Cierra y vuelve a abrir la vista previa.")}</p>}
        <button type="button" className="fit-primary" disabled={busy || !online || !previewCurrent} onClick={async () => { if (previewCurrent && await mutate("sharing", { on: true, mode: "love-v4", version: sheetVersion, relationshipId: previewRelationship })) { closeSheet(); setView("couple"); } }} data-testid="fit-confirm-share">{busy ? t("分享中…", "Sharing…", "Compartiendo…") : t("确认连接这版画像", "Connect this portrait", "Conectar esta versión")}</button>
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
