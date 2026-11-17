import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CaretRight, Heart, LockKey, UsersThree, X } from "@phosphor-icons/react";
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
  const flowKey = `pinky:fit-flow:${userId}`;
  const [data, setData] = useState<FitState | null>(null);
  const [view, setView] = useState<"mine" | "couple">("mine");
  const [flow, setFlow] = useState(() => rememberedFlow(flowKey));
  const [index, setIndex] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ id: string; value: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sheet, setSheet] = useState<"share" | "profile" | "delete" | null>(null);
  const [profileDraft, setProfileDraft] = useState({ mbti: "", zodiac: "" });
  const writes = useRef(false);
  const refreshAfterWrite = useRef(false);
  const request = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (writes.current) { refreshAfterWrite.current = true; return; }
    const ticket = ++request.current;
    try {
      const next = await relationshipApi<FitState>(`/api/fit?language=${language}`, { signal });
      if (!signal?.aborted && ticket === request.current) setData(next);
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
  const questions = data ? flow === "starter"
    ? data.modules.flatMap((module) => module.questions.slice(0, 1))
    : data.modules.find((module) => module.id === flow)?.questions || [] : [];
  const firstMissing = questions.findIndex((question) => !data?.profile.answers[question.id]);
  const currentIndex = Math.min(index ?? (firstMissing < 0 ? 0 : firstMissing), Math.max(questions.length - 1, 0));
  const question = flow && questions[currentIndex];
  const selected = question ? choice?.id === question.id ? choice.value : data?.profile.answers[question.id] || "" : "";
  const starterAnswered = data?.modules.filter((module) => data.profile.answers[module.questions[0]?.id]).length || 0;
  const starterComplete = Boolean(data && starterAnswered === data.modules.length && starterAnswered > 0);
  const finish = () => { setQuestionFlow(""); setView("mine"); };
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
  const nextQuestion = async () => {
    if (!question || !selected) return;
    if (selected !== data?.profile.answers[question.id] && !await mutate("answers", { answers: { [question.id]: selected } })) return;
    setChoice(null);
    if (currentIndex === questions.length - 1) finish();
    else setIndex(currentIndex + 1);
  };
  const closeSheet = () => { keyboard.hide(); setSheet(null); };
  const title = t("我们有多合拍", "How we connect", "Así conectamos");
  const profileTitle = t("MBTI 与星座", "MBTI & zodiac", "MBTI y signo");
  const reportSections = data?.personal?.sections || [];
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
      <button type="button" role="tab" aria-selected={view === "mine"} onClick={() => { keyboard.hide(); setView("mine"); }}><LockKey size={17} />{t("我的说明书", "My guide", "Mi guía")}</button>
      <button type="button" role="tab" aria-selected={view === "couple"} onClick={() => { keyboard.hide(); setView("couple"); }}><UsersThree size={18} />{t("我们俩的解析", "Our connection", "Nuestra conexión")}</button>
    </div>}
    <div className="fit-scroll"><MobileScroll><div className="fit-content" ref={contentRef}>
      {!online && <p className="fit-notice" role="status">{t("你现在离线，已打开的说明书可以继续看。联网后再保存。", "You're offline. You can read this guide; reconnect to save changes.", "Estás sin conexión. Puedes leer tu guía; vuelve a conectarte para guardar cambios.")}</p>}
      {error && <div className="fit-error" role="alert"><p>{error}</p><button type="button" disabled={busy || !online} onClick={() => { setError(""); void load(); }}>{t("重新加载", "Reload", "Volver a cargar")}</button></div>}
      {loading && !data && <p className="fit-notice" role="status">{t("正在打开说明书…", "Opening your guide…", "Abriendo tu guía…")}</p>}
      {question && data ? <div className="fit-question" key={question.id}>
        <div className="fit-question-progress"><span>{currentIndex + 1} / {questions.length}</span><span>{flow === "starter" ? t("先认识一点你", "A first look at you", "Para conocerte un poco") : data.modules.find((module) => module.id === flow)?.title}</span></div>
        <progress value={currentIndex + 1} max={questions.length} aria-label={t("答题进度", "Question progress", "Progreso")} />
        <h2>{question.text}</h2>
        <div className="fit-options" role="group" aria-label={t("选择最接近你的反应", "Choose what sounds most like you", "Elige lo que más se parezca a ti")}>
          {question.options.map((option) => <button type="button" key={option.id} aria-pressed={selected === option.id} disabled={busy} onClick={() => setChoice({ id: question.id, value: option.id })} data-testid="fit-option">
            <span>{option.text}</span><i aria-hidden="true">{selected === option.id && <Check size={15} weight="bold" />}</i>
          </button>)}
        </div>
        <p className="fit-fine">{t("选最像平时的反应，也可以回头改。", "Choose your usual reaction. You can change it later.", "Elige tu reacción habitual. Puedes cambiarla después.")}</p>
        {data.profile.sharing && <p className="fit-fine">{t("修改后，重新确认分享才会更新双人解析。", "After an edit, review and share again to update your connection guide.", "Después de editar, revisa y comparte de nuevo para actualizar la guía de ambos.")}</p>}
        <div className="fit-actions"><button className="fit-primary" type="button" disabled={busy || !online || !selected} onClick={() => void nextQuestion()} data-testid="fit-next">{busy ? t("保存中…", "Saving…", "Guardando…") : currentIndex === questions.length - 1 ? t("保存，看我的说明书", "Save & see my guide", "Guardar y ver mi guía") : t("保存，下一题", "Save & next", "Guardar y continuar")}<ArrowRight size={18} /></button>
          {currentIndex > 0 && <button type="button" className="fit-secondary" disabled={busy} onClick={() => { setChoice(null); setIndex(currentIndex - 1); }}>{t("上一题", "Previous", "Anterior")}</button>}</div>
      </div> : data && view === "mine" ? <>
        <div className="fit-intro">
          <div className="fit-mark" aria-hidden="true"><Heart size={35} weight="duotone" /></div>
          <h2>{data.personal?.title || t("关系里的你，是什么样？", "What are you like in love?", "¿Cómo eres en una relación?")}</h2>
          <p>{data.personal?.summary || t("从六个日常小场景开始，看看你怎样靠近一个人、表达关心、处理分歧。", "Start with six everyday situations: how you get close, show care and work through differences.", "Empieza con seis situaciones cotidianas: cómo te acercas, muestras cariño y afrontas las diferencias.")}</p>
          {data.personal && <p className="fit-fine">{data.personal.coverage}</p>}
          {data.personal && <button type="button" className="fit-copy" onClick={() => void copyReport()}>{t("复制我的解析", "Copy my guide", "Copiar mi guía")}</button>}
          {!starterComplete && <button type="button" className="fit-primary" disabled={!online || busy} onClick={() => setQuestionFlow("starter")} data-testid="fit-start">{starterAnswered ? t(`接着答 · 已保存 ${starterAnswered}/6`, `Continue · ${starterAnswered}/6 saved`, `Continuar · ${starterAnswered}/6 guardadas`) : t("用六个场景认识我", "Start with six situations", "Empezar con seis situaciones")}<ArrowRight size={18} /></button>}
        </div>
        {reportSections.map((section) => <PersonalSection key={section.id} section={section} t={t} />)}
        <section className="fit-chapters"><h2>{t("慢慢认识得更深", "A little deeper, at your pace", "Conócete más, a tu ritmo")}</h2>
          <p>{t("每个方面都可以单独补充。", "Explore each part on its own.", "Puedes explorar cada aspecto por separado.")}</p>
          <div>{data.modules.map((module) => {
            const answered = module.questions.filter((item) => data.profile.answers[item.id]).length;
            return <button className="fit-chapter" type="button" key={module.id} onClick={() => setQuestionFlow(module.id)} disabled={busy} data-testid={`fit-module-${module.id}`}><span><strong>{module.title}</strong><small>{module.description}</small></span><span className="fit-chapter-count">{answered}/{module.questions.length}<CaretRight size={17} /></span></button>;
          })}</div>
        </section>
        <button type="button" className="fit-profile-link" onClick={startProfile} disabled={busy} data-testid="fit-profile"><span><strong>{profileTitle}</strong><small>{t("补上你已经知道的自己，看看两种解读。", "Add what you already know about yourself and explore both lenses.", "Añade lo que ya conoces de ti y explora ambas miradas.")}</small></span><CaretRight size={20} /></button>
        {starterComplete && <section className="fit-sharing"><h2>{t("愿意让 TA 更懂你吗？", "Want to let them know you better?", "¿Quieres que tu pareja te conozca mejor?")}</h2><p>{data.profile.sharing
          ? t("你已分享当前这份说明书。随时可以撤回。", "You've shared this version of your guide. You can withdraw it at any time.", "Compartiste esta versión de tu guía. Puedes retirar el permiso cuando quieras.")
          : t("先预览会分享的答案和解析。两个人都确认后，才能看到双人解析。", "Preview the answers and insights you'll share. Your connection guide opens after both of you agree.", "Revisa las respuestas y lo que compartirás. La guía de ambos se abre cuando los dos aceptan.")}</p>
          {data.profile.sharing ? <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>
            : paired ? <button type="button" className="fit-primary" disabled={busy || !online} onClick={() => { keyboard.hide(); setSheet("share"); }} data-testid="fit-preview-share">{t("预览，再分享给 TA", "Preview & share with them", "Revisar y compartir")}<ArrowRight size={18} /></button>
              : <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>}
        </section>}
        {data.profile.answeredCount > 0 && <button type="button" className="fit-delete" disabled={busy} onClick={() => { keyboard.hide(); setSheet("delete"); }}>{t("删除我的答案与说明书", "Delete my answers and guide", "Eliminar mis respuestas y mi guía")}</button>}
      </> : data && <>
        <div className="fit-intro fit-couple-intro"><div className="fit-mark" aria-hidden="true"><UsersThree size={38} weight="duotone" /></div><h2>{data.couple.status === "ready" ? t("你们的相处，有迹可循", "The way you connect", "Su forma de conectar") : t("从我，到我们俩", "From me to us", "De mí a nosotros")}</h2><p>{data.couple.summary}</p>
          {data.couple.status === "unpaired" ? <button type="button" className="fit-primary" onClick={() => { keyboard.hide(); onInvite(); }}>{t("邀请 TA 一起了解", "Invite your partner", "Invitar a tu pareja")}<ArrowRight size={18} /></button>
            : data.couple.status === "need-your-share" ? <button type="button" className="fit-primary" onClick={() => { if (starterComplete) { keyboard.hide(); setSheet("share"); } else { setView("mine"); setQuestionFlow("starter"); } }}>{starterComplete ? t("预览我的分享", "Review my sharing", "Revisar lo que compartiré") : t("先认识我自己", "Start with my own guide", "Empezar por mi guía")}<ArrowRight size={18} /></button>
              : data.couple.status === "waiting" ? <p className="fit-wait" role="status">{t(`等 ${data.couple.partnerName || "TA"} 确认分享。`, `Waiting for ${data.couple.partnerName || "your partner"} to share.`, `Falta que ${data.couple.partnerName || "tu pareja"} comparta su guía.`)}</p> : null}
        </div>
        {data.couple.status === "ready" && <>
          <button type="button" className="fit-copy" onClick={() => void copyReport(true)}>{t("复制双人摘要", "Copy our summary", "Copiar nuestro resumen")}</button>
          {data.couple.sections.map((section) => <PairSection key={section.id} section={section} partnerName={data.couple.partnerName} t={t} onDiscuss={() => { keyboard.hide(); onDiscuss(`${section.title}\n${section.summary}\n${section.suggestion}`); }} />)}
          {data.couple.mbti && <section className="fit-report"><h2>{data.couple.mbti.title}</h2><p>{data.couple.mbti.summary}</p></section>}
          {data.couple.zodiac && <section className="fit-report fit-zodiac"><h2>{data.couple.zodiac.title}</h2><p className="fit-fine">{t("星座趣味解读", "Zodiac, just for fun", "Los signos, por diversión")}</p><p>{data.couple.zodiac.summary}</p></section>}
          <button className="fit-profile-link" type="button" onClick={startProfile}><span>{profileTitle}</span><CaretRight size={20} /></button>
        </>}
        {data.profile.sharing && <button type="button" className="fit-secondary" disabled={busy || !online} onClick={() => void mutate("sharing", { on: false })} data-testid="fit-withdraw-couple">{t("撤回我的分享", "Withdraw my sharing", "Retirar mi permiso")}</button>}
      </>}
      {!!copyStatus && <p className="fit-notice" role="status">{copyStatus}</p>}
    </div></MobileScroll></div>
    <BottomSheet open={sheet === "share"} onOpenChange={(open) => { if (!open) closeSheet(); }} title={t("这份说明书会分享给 TA", "The guide you'll share", "La guía que compartirás")} description={t("TA 会看到下面的答案和解析。", "Your partner will see these answers and insights.", "Tu pareja verá estas respuestas y reflexiones.")} snap={0.89}>
      <div className="fit-sheet">
        <button type="button" className="fit-sheet-close" onClick={closeSheet} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
        {data?.personal && <><h2>{data.personal.title}</h2><p>{data.personal.summary}</p><p className="fit-fine">{data.personal.coverage}</p>{reportSections.map((section) => <PersonalSection key={section.id} section={section} t={t} expanded />)}</>}
        <p>{profileTitle} · {data?.profile.mbti || t("未填写", "Not added", "Sin añadir")} / {zodiacNames.find(([id]) => id === data?.profile.zodiac)?.[language === "zh" ? 1 : language === "en" ? 2 : 3] || t("未填写", "Not added", "Sin añadir")}</p>
        <button type="button" className="fit-primary" disabled={busy || !online || !starterComplete} onClick={async () => { if (await mutate("sharing", { on: true })) { closeSheet(); setView("couple"); } }} data-testid="fit-confirm-share">{busy ? t("分享中…", "Sharing…", "Compartiendo…") : t("确认分享这份说明书", "Share this version of my guide", "Compartir esta versión de mi guía")}</button>
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

function PersonalSection({ section, t, expanded = false }: { section: FitSection; t: Translate; expanded?: boolean }) {
  return <section className="fit-report" data-testid={`fit-report-${section.id}`}><h2>{section.title}</h2><p>{section.summary}</p>
    <details open={expanded || undefined}><summary>{t("看看依据", "See what this is based on", "Ver en qué se basa")}<CaretRight size={15} /></summary><div className="fit-evidence">{section.evidence.map((item) => <div key={item.questionId}><p>{item.question}</p><blockquote>{item.answer}</blockquote><p>{item.meaning}</p></div>)}</div></details>
    <p className="fit-suggestion">{section.suggestion}</p></section>;
}

function PairSection({ section, partnerName, t, onDiscuss }: { section: FitPairSection; partnerName: string; t: Translate; onDiscuss: () => void }) {
  const status = section.status === "same" ? t("这里想到一起了", "On the same page", "Aquí coinciden") : section.status === "mixed" ? t("有共鸣，也有不同", "Some shared ground, some differences", "Coincidencias y diferencias") : section.status === "different" ? t("值得聊聊的不同", "A difference to talk about", "Una diferencia para conversar") : t("还可以多了解一点", "More to discover", "Queda por descubrir");
  return <section className={`fit-report fit-pair-${section.status}`} data-testid={`fit-couple-${section.id}`}><h2>{section.title}</h2><p className="fit-status">{status}</p><p>{section.summary}</p>
    {!!section.evidence.length && <details><summary>{t("看看双方的答案", "See both answers", "Ver las dos respuestas")}<CaretRight size={15} /></summary><div className="fit-evidence">{section.evidence.map((item) => <div key={item.questionId}><p>{item.question}</p><dl><dt>{t("你", "You", "Tú")}</dt><dd>{item.mine}</dd><dt>{partnerName}</dt><dd>{item.partner}</dd></dl></div>)}</div></details>}
    <p className="fit-suggestion">{section.suggestion}</p>{section.status !== "unknown" && <button className="fit-discuss" type="button" onClick={onDiscuss}>{t("带回我们俩聊聊", "Talk about this in Us", "Llevarlo al chat")}<ArrowRight size={16} /></button>}</section>;
}
