import { useState, type ReactNode } from "react";
import { ChatCircleDots, Heart, List, LockKey, Microphone, Phone, UsersThree, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// Per device: once someone has seen it on this phone, it does not return (tests and demos set the same key).
const seenKey = (_userId: string) => "toward-us:onboarded";
export const tourSeen = (userId: string) => { try { return localStorage.getItem(seenKey(userId)) === "1"; } catch { return true; } };
const markSeen = (userId: string) => { try { localStorage.setItem(seenKey(userId), "1"); } catch { /* Shown again next time; harmless. */ } };

/** Three light cards the first time someone opens Pinky: the private chat, the shared one, and where things live. */
export function OnboardingTour({ language, userId, paired, onInvite, onDone }: { language: Language; userId: string; paired: boolean; onInvite: () => void; onDone: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [step, setStep] = useState(0);
  const finish = () => { markSeen(userId); onDone(); };
  const steps = [
    { icon: <LockKey size={30} weight="duotone" />, title: t("“只有我”：只属于你", "Just me: only yours", "Solo yo: solo tuyo"), text: t("想记的、想查的、难开口的，都可以跟 Pinky 说。这里只有你能看到；要给 TA 的话，你确认后才会发出。", "Tell Pinky anything you want to remember, look up or find hard to say. Only you see this; nothing reaches your partner until you confirm.", "Cuéntale a Pinky lo que quieras recordar, buscar o te cueste decir. Solo tú lo ves; nada llega a tu pareja sin tu confirmación.") },
    { icon: <UsersThree size={30} weight="duotone" />, title: t("“我们俩”：你们俩和 Pinky", "Us: the two of you and Pinky", "Nosotros: ustedes dos y Pinky"), text: t("你们两个人都能看到。叫一声“Pinky”它就来帮忙：定约定、排计划、吵架时帮你们调解。", "You both see everything here. Say “Pinky” and it helps: settle agreements, plan things, mediate when you argue.", "Los dos ven todo aquí. Digan «Pinky» y ayuda: acordar cosas, planear, mediar cuando discuten."), action: paired ? null : t("邀请 TA 加入", "Invite your partner", "Invita a tu pareja") },
    { icon: <Heart size={30} weight="duotone" />, title: t("其他都在这里", "Where things live", "Dónde está todo"), list: [
      [<List size={18} />, t("左上角菜单：约定、即将到来、回忆", "Top-left menu: agreements, coming up, moments", "Menú arriba a la izquierda: acuerdos, próximamente, momentos")],
      [<ChatCircleDots size={18} />, t("输入框上方的小建议，不知道说什么时点一下", "The small ideas above the box, when you don't know what to say", "Las ideas sobre el cuadro, cuando no sepas qué decir")],
      [<Microphone size={18} />, t("麦克风：直接说话", "Microphone: just talk", "Micrófono: solo habla")],
      [<Phone size={18} />, t("电话：和 Pinky 实时通话，几个人一起也行", "Phone: a live call with Pinky, even with others in the room", "Teléfono: una llamada con Pinky, incluso con más personas")],
    ] as Array<[ReactNode, string]> },
  ];
  const current = steps[step];
  return <div className="onboarding-layer" role="dialog" aria-modal="true" aria-label={t("欢迎来到 Pinky", "Welcome to Pinky", "Bienvenido a Pinky")} data-testid="onboarding">
    <div className="onboarding-card">
      <button type="button" className="onboarding-skip" onClick={finish} aria-label={t("跳过", "Skip", "Saltar")}><X size={20} /></button>
      <span className="onboarding-icon">{current.icon}</span>
      <h2>{current.title}</h2>
      {"text" in current && current.text && <p>{current.text}</p>}
      {"list" in current && current.list && <ul>{current.list.map(([icon, text], index) => <li key={index}>{icon}<span>{text}</span></li>)}</ul>}
      <div className="onboarding-dots" aria-hidden="true">{steps.map((_, index) => <i key={index} className={index === step ? "on" : ""} />)}</div>
      <div className="onboarding-actions">
        {"action" in current && current.action && <button type="button" className="onboarding-secondary" onClick={() => { finish(); onInvite(); }}>{current.action}</button>}
        <button type="button" className="onboarding-next" onClick={() => step < steps.length - 1 ? setStep(step + 1) : finish()} data-testid="onboarding-next">{step < steps.length - 1 ? t("下一步", "Next", "Siguiente") : t("开始吧", "Let's start", "Empecemos")}</button>
      </div>
    </div>
  </div>;
}
