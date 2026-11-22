import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
import type { Pairing } from "../../Prototype";
import { AiConsentScreen } from "../privacy/AiConsent";
import { relationshipApi } from "../relationship/api";
import { PartnerInvite } from "./PartnerInvite";
import "./first-run.css";
import { draftKey, readDraft, type Draft } from "./firstRunDraft";

export { firstRunInProgress } from "./firstRunDraft";

type Preferences = { preferredName: string; completed: boolean };
const endpoint = "/api/privacy/first-run";

export function FirstRun({ user, feedback, language, pairing, onPairingChange, onRefreshPairing, onAgreed, onDecline }: {
  user: { id: string; name: string }; feedback: ReactNode; language: Language; pairing: Pairing | null;
  onPairingChange: (next: Pairing | null) => void; onRefreshPairing: () => Promise<void>;
  onAgreed: (at: string) => void; onDecline: () => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const key = draftKey(user.id);
  const keyboard = useKeyboard();
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(key));
  const [returning, setReturning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (readDraft(key)) return;
    let active = true;
    setError(false);
    relationshipApi<Preferences>(endpoint, { signal: AbortSignal.timeout(12000) }).then(prefs => {
      if (!active) return;
      setReturning(prefs.completed);
      setDraft({ step: prefs.completed ? 3 : 1, name: prefs.preferredName || user.name });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [key, user.name, attempt]);

  const change = (next: Draft) => {
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* still usable in memory */ }
    setDraft(next); setError(false);
  };
  const clear = () => { try { localStorage.removeItem(key); } catch { /* optional storage */ } };
  const go = (step: Draft["step"]) => { keyboard.hide(); if (draft) change({ ...draft, step }); };
  const next = async () => {
    if (!draft || saving) return;
    keyboard.hide(); setError(false); setSaving(true);
    try {
      await relationshipApi(endpoint, { method: "PUT", body: JSON.stringify({ preferredName: draft.name }), signal: AbortSignal.timeout(12000) });
      change({ ...draft, step: 3 });
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  const progress = draft && <nav className="first-run-progress" aria-label={t("设置进度", "Setup progress", "Progreso de configuración")}>
    <button type="button" aria-label={t("返回", "Back", "Volver")} disabled={saving} onClick={() => draft.step === 1 ? onDecline() : go(draft.step === 3 ? 2 : 1)}><ArrowLeft size={21} /></button>
    <span role="status">{t(`第 ${draft.step} 步，共 3 步`, `Step ${draft.step} of 3`, `Paso ${draft.step} de 3`)}</span>
  </nav>;
  const header = <div className="first-run-top">{!returning && progress}{feedback}</div>;
  const problem = t("暂时连不上 Ourever。检查网络后重试。", "Ourever couldn’t connect. Check your connection and try again.", "No se pudo conectar con Ourever. Comprueba tu conexión y vuelve a intentarlo.");
  if (draft?.step === 3) return <AiConsentScreen language={language} header={header}
    onAgreed={at => { clear(); onAgreed(at); }} onDecline={() => { clear(); onDecline(); }} />;
  return <MobileScroll key={draft?.step} className="paper-screen first-run-screen"><main className="first-run">
    {header}
    {!draft ? <><p role="status">{error ? problem : t("正在打开…", "Opening…", "Abriendo…")}</p>
      {error && <button className="primary-action" onClick={() => setAttempt(n => n + 1)}>{t("重试", "Retry", "Reintentar")}</button>}</>
      : draft.step === 1 ? <>
        <h1>{t("欢迎来到 Ourever", "Welcome to Ourever", "Te damos la bienvenida a Ourever")}</h1>
        <p>{t("你可以先私下聊聊感情里的小事，也可以邀请伴侣一起聊。", "Talk through a moment in your relationship privately, or invite your partner to talk together.", "Habla en privado sobre un momento de tu relación o invita a tu pareja para conversar juntos.")}</p>
        <label className="first-run-name">{t("在私人空间里怎么称呼你？", "What should we call you in your private space?", "¿Cómo te llamamos en tu espacio privado?")}
          <KeyboardInput value={draft.name} maxLength={24} autoComplete="given-name" onChange={e => change({ ...draft, name: e.target.value })} />
        </label>
        <button type="button" className="primary-action" disabled={!draft.name.trim()} onClick={() => go(2)}>{t("继续", "Continue", "Continuar")}</button>
      </> : <>
        <h1>{t("你们的共同空间", "A space for the two of you", "Un espacio para los dos")}</h1>
        {pairing?.status === "active" ? <p role="status">{t("伴侣已加入。", "Your partner has joined.", "Tu pareja ya se ha unido.")}</p> :
          <PartnerInvite userId={user.id} language={language} pairing={pairing} onPairingChange={onPairingChange} onRefreshPairing={onRefreshPairing} />}
        {error && <p role="alert">{problem}</p>}
        <button className="secondary-action" type="button" disabled={saving} onClick={() => void next()}>
          {saving ? t("正在保存…", "Saving…", "Guardando…") : error ? t("重试", "Retry", "Reintentar") : t("进入我的私人空间", "Continue to my private space", "Ir a mi espacio privado")}
        </button>
      </>}
  </main></MobileScroll>;
}
