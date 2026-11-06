import { GameController, Play } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { gameCatalog } from "./catalog";
import "./games.css";

/** The card in Us when one of them starts a game in the hall; tapping it opens that game's screen. */
export function MatchInviteCard({ match, userId, partnerName, language, onOpen }: { match: { id: string; game: string; invitedBy: string }; userId: string; partnerName: string; language: Language; onOpen: (id: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const name = gameCatalog(language).find((game) => game.id === match.game)?.name || match.game;
  const line = match.invitedBy === userId ? t(`你开了一局${name}，等 ${partnerName} 来玩`, `You started a game of ${name} with ${partnerName}`, `Empezaste una partida de ${name} con ${partnerName}`) : t(`${partnerName} 开了一局${name}，来一起玩吧`, `${partnerName} started a game of ${name}. Come play`, `${partnerName} empezó una partida de ${name}. Ven a jugar`);
  return <article className="conversation-card match-invite" data-testid="match-invite">
    <GameController size={22} weight="duotone" aria-hidden="true" />
    <p>{line}</p>
    <button type="button" className="game-play" onClick={() => onOpen(match.id)} data-testid="match-invite-open"><Play size={14} weight="fill" />{t("进入", "Open", "Entrar")}</button>
  </article>;
}
