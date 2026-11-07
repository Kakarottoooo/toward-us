import { useEffect, useState, type ReactNode } from "react";
import { CaretDown, ChatCircleText, GameController, Handshake, Heart, PawPrint } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";
import { togetherStats } from "../moments/together";
import { daysUntil } from "./DistanceBar";
import { gameCatalog } from "../games/catalog";
import "./us-home.css";

type Member = { id: string; name: string };
type Match = { id: string; game: string; status: string; turn: string | null; players: string[] };
type Today = { key: string; icon: ReactNode; tone: string; title: string; detail: string; action: string; onClick: () => void };

/** 两个人的家 (founder 11-06): the top of Us shows the two of them first (both names, their little one, how long they have been
 * together, when they next meet), then at most three small things waiting today (a move in a game, today's question, an
 * agreement to say yes to, the little one to pet), each saying what happened and what is yours to do. The chat follows. It
 * folds to one line when they want more room, and stays folded until they open it again. */
export function UsHome({ language, userId, members, petPicture, nextMeeting, refreshKey, daily, agreementWaiting, petWaiting, onDaily, onAgreement, onPet, onGame }: {
  language: Language; userId: string; members: Member[]; petPicture: string | null; nextMeeting: { date: string; title: string } | null; refreshKey: unknown;
  daily: { partnerAnswered: boolean } | null; agreementWaiting: boolean; petWaiting: boolean;
  onDaily: () => void; onAgreement: () => void; onPet: () => void; onGame: (matchId: string) => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const foldKey = `toward-us:us-home-folded:${userId}`;
  const [folded, setFolded] = useState(() => { try { return sessionStorage.getItem(foldKey) === "1"; } catch { return false; } });
  const [since, setSince] = useState<string | null>(null), [matches, setMatches] = useState<Match[]>([]);
  useEffect(() => {
    relationshipApi<{ graph: { milestones: Array<{ type?: string; date?: string; archivedAt?: string | null }> } }>("/api/relationship/home")
      .then((result) => setSince(result.graph.milestones.find((item) => item.type === "relationship_started" && !item.archivedAt)?.date || null)).catch(() => {});
  }, []);
  useEffect(() => { relationshipApi<{ matches: Match[] }>("/api/matches").then((result) => setMatches(result.matches)).catch(() => {}); }, [refreshKey]);
  const fold = (next: boolean) => { setFolded(next); try { sessionStorage.setItem(foldKey, next ? "1" : "0"); } catch { /* For this visit only. */ } };

  const me = members.find((member) => member.id === userId), partner = members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  const stats = since ? togetherStats(since, new Date().toLocaleDateString("en-CA")) : null;
  const meet = nextMeeting ? daysUntil(nextMeeting.date) : null;
  const names = gameCatalog(language);
  const myMove = matches.find((match) => match.status === "active" && !match.players.includes("pet") && (match.turn === userId || match.turn === "both"));

  const today: Today[] = [
    ...(myMove ? [{ key: "game", icon: <GameController size={18} weight="fill" />, tone: "game", title: t(`${names.find((game) => game.id === myMove.game)?.name || "小游戏"} · 轮到你`, `${names.find((game) => game.id === myMove.game)?.name || "Game"} · your move`, `${names.find((game) => game.id === myMove.game)?.name || "Juego"} · te toca`), detail: t(`${partnerName} 在等你`, `${partnerName} is waiting for you`, `${partnerName} te espera`), action: t("去下", "Play", "Jugar"), onClick: () => onGame(myMove.id) }] : []),
    ...(daily ? [{ key: "daily", icon: <ChatCircleText size={18} weight="fill" />, tone: "daily", title: t("今天的问题", "Today's question", "La pregunta de hoy"), detail: daily.partnerAnswered ? t(`${partnerName} 已经答了，你答完就能看到`, `${partnerName} answered; answer to see it`, `${partnerName} ya respondió; responde para verlo`) : t(`答完，等 ${partnerName} 也答了就能互相看到`, `Answer; you'll both see once ${partnerName} does too`, `Responde; lo verán cuando ${partnerName} también responda`), action: t("去答", "Answer", "Responder"), onClick: onDaily }] : []),
    ...(agreementWaiting ? [{ key: "agreement", icon: <Handshake size={18} weight="fill" />, tone: "agreement", title: t("一个约定等你点头", "An agreement waits for your yes", "Un acuerdo espera tu sí"), detail: t("两个人都同意才算数", "It counts once you both agree", "Cuenta cuando los dos aceptan"), action: t("去看", "Look", "Ver"), onClick: onAgreement }] : []),
    ...(petWaiting ? [{ key: "pet", icon: <PawPrint size={18} weight="fill" />, tone: "pet", title: t("摸一摸小家伙", "Pet your little one", "Acaricia a tu pequeñín"), detail: t("今天还没摸，它在等你", "Not yet today; it's waiting", "Aún no hoy; te espera"), action: t("去摸", "Pet", "Ir"), onClick: onPet }] : []),
  ].slice(0, 3);

  const avatar = (name: string | undefined) => <span className="us-home-avatar" aria-hidden="true">{(name || "?").trim().slice(0, 2)}</span>;
  const days = stats ? t(`在一起第 ${stats.days} 天`, `Day ${stats.days} together`, `Día ${stats.days} juntos`) : t("你们俩的家", "Your home together", "Su hogar juntos");
  const meetLine = meet === null || meet < 0 ? "" : meet === 0 ? t("今天见面！", "You meet today!", "¡Hoy se ven!") : meet === 1 ? t("明天见面", "You meet tomorrow", "Se ven mañana") : t(`还有 ${meet} 天见面`, `${meet} days until you meet`, `Faltan ${meet} días para verse`);

  if (folded) return <button type="button" className="us-home-folded" onClick={() => fold(false)} aria-expanded={false} data-testid="us-home-folded">
    <Heart size={14} weight="fill" /><span>{days}{today.length ? t(` · ${today.length} 件等你`, ` · ${today.length} waiting`, ` · ${today.length} pendientes`) : ""}</span><CaretDown size={14} />
  </button>;

  return <section className="us-home" aria-label={t("我们俩的家", "Our home", "Nuestro hogar")} data-testid="us-home">
    <div className="us-home-hero">
      <div className="us-home-pair">
        {avatar(me?.name)}<Heart size={18} weight="fill" className="us-home-heart" />{avatar(partner?.name)}
        <button type="button" className="us-home-pet" onClick={onPet} aria-label={t("小家伙", "Little one", "Pequeñín")}>{petPicture ? <img src={petPicture} alt="" draggable={false} /> : <PawPrint size={20} weight="fill" />}</button>
      </div>
      <strong>{days}</strong>
      {meetLine && <small>{meetLine}</small>}
      <button type="button" className="us-home-fold" onClick={() => fold(true)} aria-label={t("收起", "Fold", "Plegar")} aria-expanded={true}><CaretDown size={16} /></button>
    </div>
    {!!today.length && <div className="us-home-today">
      <small>{t("今天", "Today", "Hoy")}</small>
      {today.map((item) => <button key={item.key} type="button" className={`us-home-card tone-${item.tone}`} onClick={item.onClick} data-testid={`us-today-${item.key}`}>
        <span className="us-home-card-icon">{item.icon}</span>
        <span className="us-home-card-text"><b>{item.title}</b><em>{item.detail}</em></span>
        <span className="us-home-card-go">{item.action}</span>
      </button>)}
    </div>}
  </section>;
}
