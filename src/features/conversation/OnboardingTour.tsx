import { useState, type ReactNode } from "react";
import { ChatCircleDots, Heart, List, LockKey, Microphone, Phone, Sticker, UsersThree, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// Per device: once someone has seen it on this phone, it does not return (tests and demos set the same key).
const seenKey = (_userId: string) => "toward-us:onboarded";
export const tourSeen = (userId: string) => { try { return localStorage.getItem(seenKey(userId)) === "1"; } catch { return true; } };
const markSeen = (userId: string) => { try { localStorage.setItem(seenKey(userId), "1"); } catch { /* Shown again next time; harmless. */ } };
// Someone who took the tour before their partner joined saw "make your character" without a button: the card is owed to
// them and comes back once, on its own, after pairing.
const owedKey = (userId: string) => `toward-us:character-owed:${userId}`;
export const characterOwed = (userId: string) => { try { return localStorage.getItem(owedKey(userId)) === "1"; } catch { return false; } };
const setOwed = (userId: string, owed: boolean) => { try { if (owed) localStorage.setItem(owedKey(userId), "1"); else localStorage.removeItem(owedKey(userId)); } catch { /* Not offered again; harmless. */ } };

/** Light cards the first time someone opens Pinky: the private chat, the shared one, where things live, and the couple's own character. */
export function OnboardingTour({ language, userId, paired, onInvite, onCharacter, onDone, characterOnly = false }: { language: Language; userId: string; paired: boolean; onInvite: () => void; onCharacter: () => void; onDone: () => void; characterOnly?: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [step, setStep] = useState(0);
  const finish = () => { if (characterOnly) setOwed(userId, false); else { markSeen(userId); if (!paired) setOwed(userId, true); } onDone(); };
  const steps: Array<{ icon: ReactNode; title: string; text?: string; list?: Array<[ReactNode, string]>; action?: { label: string; run: () => void } | null }> = [
    { icon: <LockKey size={30} weight="duotone" />, title: t("“只有我”：只属于你", "Just me: only yours", "Solo yo: solo tuyo"), text: t("想记的、想查的、难开口的，都可以跟 Pinky 说。这里只有你能看到；要给 TA 的话，你确认后才会发出。", "Tell Pinky anything you want to remember, look up or find hard to say. Only you see this; nothing reaches your partner until you confirm.", "Cuéntale a Pinky lo que quieras recordar, buscar o te cueste decir. Solo tú lo ves; nada llega a tu pareja sin tu confirmación.") },
    { icon: <UsersThree size={30} weight="duotone" />, title: t("“我们俩”：你们俩和 Pinky", "Us: the two of you and Pinky", "Nosotros: ustedes dos y Pinky"), text: t("你们两个人都能看到。叫一声“Pinky”它就来帮忙：定约定、排计划、吵架时帮你们调解。", "You both see everything here. Say “Pinky” and it helps: settle agreements, plan things, mediate when you argue.", "Los dos ven todo aquí. Digan «Pinky» y ayuda: acordar cosas, planear, mediar cuando discuten."), action: paired ? null : { label: t("邀请 TA 加入", "Invite your partner", "Invita a tu pareja"), run: onInvite } },
    { icon: <Heart size={30} weight="duotone" />, title: t("其他都在这里", "Where things live", "Dónde está todo"), list: [
      [<List size={18} />, t("左上角菜单：约定、即将到来、回忆", "Top-left menu: agreements, coming up, moments", "Menú arriba a la izquierda: acuerdos, próximamente, momentos")],
      [<ChatCircleDots size={18} />, t("输入框上方的小建议，不知道说什么时点一下", "The small ideas above the box, when you don't know what to say", "Las ideas sobre el cuadro, cuando no sepas qué decir")],
      [<Microphone size={18} />, t("麦克风：直接说话", "Microphone: just talk", "Micrófono: solo habla")],
      [<Phone size={18} />, t("电话：和 Pinky 实时通话，几个人一起也行", "Phone: a live call with Pinky, even with others in the room", "Teléfono: una llamada con Pinky, incluso con más personas")],
    ] },
    // 做我们的角色 (the founder, 11-03): a photo of their pet becomes a moving character both of them see at the top.
    { icon: <Sticker size={30} weight="duotone" />, title: t("做你们的角色", "Make your own character", "Creen su propio personaje"), text: paired
      ? t("拍一张你们宠物的照片，或上传截图、喜欢的形象，Pinky 会把它做成会动的小角色，浮在对话顶部陪着你们俩。以后也可以在设置里做或隐藏。", "Take a photo of your pet, or upload a screenshot or a figure you love: Pinky turns it into a little moving character that floats at the top of your conversation for both of you. You can also make or hide it later in Settings.", "Hazle una foto a su mascota, o sube una captura o una figura que les guste: Pinky la convierte en un personaje que se mueve y flota arriba de su conversación para los dos. También pueden crearlo u ocultarlo luego en Ajustes.")
      : t("TA 加入后，拍一张你们宠物的照片（或上传喜欢的形象），Pinky 会把它做成会动的小角色，浮在对话顶部陪着你们俩。在设置里做。", "Once your partner joins, take a photo of your pet (or upload a figure you love) and Pinky turns it into a little moving character at the top of your conversation. Make it in Settings.", "Cuando tu pareja se una, hazle una foto a su mascota (o sube una figura que les guste) y Pinky la convierte en un personaje que se mueve arriba de su conversación. Créenlo en Ajustes."),
      action: paired ? { label: t("现在就做", "Make it now", "Crearlo ahora"), run: onCharacter } : null },
  ];
  if (characterOnly) steps.splice(0, steps.length - 1);
  const current = steps[step];
  return <div className="onboarding-layer" role="dialog" aria-modal="true" aria-label={t("欢迎来到 Pinky", "Welcome to Pinky", "Bienvenido a Pinky")} data-testid="onboarding">
    <div className="onboarding-card">
      {!current.action && <button type="button" className="onboarding-skip" onClick={finish} aria-label={t("跳过", "Skip", "Saltar")}><X size={20} /></button>}
      <span className="onboarding-icon">{current.icon}</span>
      <h2>{current.title}</h2>
      {current.text && <p>{current.text}</p>}
      {current.list && <ul>{current.list.map(([icon, text], index) => <li key={index}>{icon}<span>{text}</span></li>)}</ul>}
      <div className="onboarding-dots" aria-hidden="true">{steps.map((_, index) => <i key={index} className={index === step ? "on" : ""} />)}</div>
      <div className="onboarding-actions">
        {current.action && <button type="button" className="onboarding-secondary" onClick={() => { finish(); current.action!.run(); }} data-testid="onboarding-action">{current.action.label}</button>}
        <button type="button" className="onboarding-next" onClick={() => step < steps.length - 1 ? setStep(step + 1) : finish()} data-testid="onboarding-next">{step < steps.length - 1 ? t("下一步", "Next", "Siguiente") : t("开始吧", "Let's start", "Empecemos")}</button>
      </div>
    </div>
  </div>;
}
