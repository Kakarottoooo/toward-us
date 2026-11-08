import { useEffect, useState, type ReactNode } from "react";
import { AirplaneTilt, Alarm, BookOpenText, ChatTeardropText, Drop, EnvelopeSimpleOpen, GameController, Handshake, Heart, Images, PawPrint, Sparkle, UserCircle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";

type Channel = "me" | "us";
export type DiscoverKey = "ideas" | "games" | "miss_you" | "pet" | "meetup" | "recap" | "agreement" | "profile" | "letter" | "photos" | "hard_words" | "reminder" | "cycle";
// The order things are shown in, one a day per conversation, skipping what is already in use.
const ORDER: Record<Channel, DiscoverKey[]> = { us: ["games", "ideas", "miss_you", "pet", "meetup", "recap", "agreement"], me: ["letter", "profile", "photos", "hard_words", "reminder", "cycle"] };

type Memory = { dismissed: DiscoverKey[]; current: Partial<Record<Channel, DiscoverKey>>; day: Partial<Record<Channel, string>> };
const keyFor = (userId: string) => `pinky-discover:${userId}`;
const load = (userId: string): Memory => { try { return { dismissed: [], current: {}, day: {}, ...JSON.parse(localStorage.getItem(keyFor(userId)) || "{}") }; } catch { return { dismissed: [], current: {}, day: {} }; } };
const save = (userId: string, memory: Memory) => { try { localStorage.setItem(keyFor(userId), JSON.stringify(memory)); } catch { /* shown again next time */ } };

/** 主动展示功能 (founder 11-06): at the end of each conversation, one thing this member has not tried yet, with a button that
 * does it (or starts the sentence for it). A new one at most once a day per conversation; tried or "知道了" and it goes. */
export function DiscoveryCard({ userId, channel, paired, language, partnerName, refreshKey, onAction }: { userId: string; channel: Channel; paired: boolean; language: Language; partnerName: string; refreshKey: number; onAction: (key: DiscoverKey) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [used, setUsed] = useState<Set<string> | null>(null);
  const [memory, setMemory] = useState<Memory>(() => load(userId));
  useEffect(() => { relationshipApi<{ used: string[] }>("/api/discover").then((result) => setUsed(new Set(result.used))).catch(() => setUsed(null)); }, [userId, refreshKey]);
  const today = new Date().toLocaleDateString("en-CA");
  const open = (key: DiscoverKey) => used !== null && !used.has(key) && !memory.dismissed.includes(key);
  let key: DiscoverKey | null = null;
  if (used && (channel === "me" || paired)) {
    const current = memory.current[channel];
    if (current && open(current)) key = current;
    else if (memory.day[channel] !== today) key = ORDER[channel].find(open) || null;
  }
  useEffect(() => {
    if (key && memory.current[channel] !== key) { const next = { ...memory, current: { ...memory.current, [channel]: key }, day: { ...memory.day, [channel]: today } }; setMemory(next); save(userId, next); }
  }, [key, channel]);
  if (!key) return null;
  const done = (chosen: DiscoverKey) => { const next = { ...memory, dismissed: [...memory.dismissed, chosen], current: { ...memory.current, [channel]: undefined } }; setMemory(next); save(userId, next); };
  const partner = partnerName || t("TA", "your partner", "tu pareja");
  const cards: Record<DiscoverKey, { icon: ReactNode; title: string; text: string; button?: string }> = {
    ideas: { icon: <Sparkle size={20} weight="fill" />, title: t("不知道一起做点什么？", "Not sure what to do together?", "¿No saben qué hacer juntos?"), text: t("一张 100 件小事的海报：看日落、做大餐、去没去过的地方……做过的格子会变成你们那天的照片。", "A poster of 100 little things: a sunset, a big dinner, somewhere new… Each one you do becomes your photo from that day.", "Un póster de 100 cosas: un atardecer, una gran cena, un sitio nuevo… Cada una que hagan se vuelve su foto de ese día."), button: t("打开海报", "Open the poster", "Abrir el póster") },
    games: { icon: <GameController size={20} weight="fill" />, title: t("来玩个小游戏", "Play a little game", "Jueguen un juego"), text: t("象棋、五子棋、情侣飞行棋、海龟汤、你画我猜……十几个双人小游戏，挑一个一起玩。TA 不在时也能和小家伙玩。", "Chinese chess, gomoku, couples' ludo, lateral puzzles, draw & guess and more: pick one to play together, or play your little one.", "Ajedrez chino, gomoku, parchís, acertijos, dibuja y adivina y más: elijan uno para jugar juntos, o juega con tu pequeñín."), button: t("去看看", "Take a look", "Ver juegos") },
    miss_you: { icon: <Heart size={20} weight="fill" />, title: t(`想 ${partner} 了？`, `Thinking of ${partner}?`, `¿Piensas en ${partner}?`), text: t(`点上面的爱心，${partner} 那边会飘起爱心。`, `Tap the heart at the top and hearts float up on ${partner}'s side.`, `Toca el corazón de arriba y a ${partner} le aparecen corazones.`), button: t("发一个想你了", "Send one now", "Enviar uno") },
    pet: { icon: <PawPrint size={20} weight="fill" />, title: t("你们一起养的小家伙", "Your little one", "Su pequeño"), text: t("你们一起答题、玩游戏、存回忆，它都会长大。每人每天能摸它一次。", "It grows with everything you do together; each of you can pet it once a day.", "Crece con lo que hacen juntos; cada uno puede acariciarlo una vez al día."), button: t("摸摸它", "Pet it", "Acariciarlo") },
    meetup: { icon: <AirplaneTilt size={20} weight="fill" />, title: t("下次什么时候见面？", "When do you meet next?", "¿Cuándo se ven?"), text: t("跟 Pinky 说日期，你们俩顶部都会倒数“还有几天见面”。", "Tell Pinky the date and you both see the countdown.", "Dile la fecha a Pinky y ambos verán la cuenta atrás."), button: t("说个日期", "Tell the date", "Decir la fecha") },
    recap: { icon: <BookOpenText size={20} weight="fill" />, title: t("做一张回顾卡", "Make a recap", "Hagan un resumen"), text: t("把最近一段时间做成你们的小故事。", "Turn a stretch of time into your little story.", "Conviertan un tiempo en su pequeña historia."), button: t("试试", "Try it", "Probar") },
    agreement: { icon: <Handshake size={20} weight="fill" />, title: t("把说好的写下来", "Write down what you agree", "Anoten lo acordado"), text: t("两个人都同意才算数，Pinky 会帮你们跟进。", "It counts once you both approve, and Pinky follows up.", "Vale cuando ambos aprueban, y Pinky da seguimiento."), button: t("试试", "Try it", "Probar") },
    profile: { icon: <UserCircle size={20} weight="fill" />, title: t(`Pinky 会记住 ${partner} 的喜好`, `Pinky remembers what ${partner} likes`, `Pinky recuerda lo que le gusta a ${partner}`), text: t("聊到的喜好、雷区、想要的东西，它会自己记下，挑礼物时用上。只有你能看到。", "Likes, sore spots and wishes you mention are kept for gifts and ideas. Only you see them.", "Gustos, puntos sensibles y deseos que mencionas se guardan para regalos. Solo tú los ves."), button: t("看看记了什么", "See what it knows", "Ver qué sabe") },
    letter: { icon: <EnvelopeSimpleOpen size={20} weight="fill" />, title: t("写一封留到那天的信", "A letter for a special day", "Una carta para un día especial"), text: t(`Pinky 帮你写好先存着，${partner} 完全不知道；到了那天提醒你，一键用短信或邮件发给 TA。`, `Pinky helps you write it and keeps it; ${partner} won't know. On the day it reminds you and you send it in one tap by text or email.`, `Pinky te ayuda a escribirla y la guarda; ${partner} no lo sabrá. Ese día te avisa y la envías con un toque por mensaje o correo.`), button: t("写一封", "Write one", "Escribir una") },
    photos: { icon: <Images size={20} weight="fill" />, title: t("把合照变成回忆", "Turn your photos into memories", "Sus fotos en recuerdos"), text: t("连上相册，或让 Pinky 从相册里找你们俩的合照，按日子和地点整理，还有地图。", "Connect an album, or let Pinky find photos of you two; sorted by day and place, with a map.", "Conecta un álbum o deja que Pinky encuentre fotos de ustedes; por día y lugar, con mapa."), button: t("去看看", "Take a look", "Ver") },
    hard_words: { icon: <ChatTeardropText size={20} weight="fill" />, title: t("有话不好说？", "Something hard to say?", "¿Algo difícil de decir?"), text: t(`先跟 Pinky 理一理，再写成 ${partner} 听得进去的话，你确认了才发。`, `Sort it out here first; it reaches ${partner} only after you confirm.`, `Ordénalo aquí; llega a ${partner} solo si confirmas.`), button: t("说说看", "Talk it through", "Hablarlo") },
    reminder: { icon: <Alarm size={20} weight="fill" />, title: t("让 Pinky 提醒你", "Let Pinky remind you", "Que Pinky te recuerde"), text: t("一次的、每周的，到点提醒。", "Once or every week, on time.", "Una vez o cada semana, a tiempo."), button: t("设个提醒", "Set one", "Crear uno") },
    cycle: { icon: <Drop size={20} weight="fill" />, title: t("也可以在这里记经期", "You can track your period here", "Puedes llevar tu periodo aquí"), text: t("说“姨妈来了 / 结束了”就行，预测只有你自己看得到。", "Just say when it starts or ends; the estimate is only for you.", "Solo di cuándo empieza o termina; la estimación es solo para ti.") },
  };
  const card = cards[key];
  return <article className="discovery-card" data-testid={`discover-${key}`}>
    <span className="discovery-icon">{card.icon}</span>
    <div><small><Sparkle size={12} weight="fill" />{t("试试看", "Try this", "Prueba esto")}</small><strong>{card.title}</strong><p>{card.text}</p>
      <span className="discovery-actions">{card.button && <button type="button" className="discovery-go" onClick={() => { done(key!); onAction(key!); }}>{card.button}</button>}<button type="button" className="discovery-later" onClick={() => done(key!)}>{t("知道了", "Got it", "Entendido")}</button></span></div>
  </article>;
}
