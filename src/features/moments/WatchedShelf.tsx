import { FilmSlate, Popcorn } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// 一起看过的 (founder 11-07): the couple's shelf of shows and films, filled by telling Pinky ("我们昨晚看完了《沙丘2》")
// or by answering its next-day "看完了吗？". Text cards for now; posters can come later from a film database.
export type WatchedItem = { id: string; title: string; text: string; date: string | null; done: boolean; createdAt: string };

export function WatchedShelf({ language, items, onAsk }: { language: Language; items: WatchedItem[]; onAsk: (text: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const watched = items.filter((item) => item.done).sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
  const later = items.filter((item) => !item.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const day = (value: string | null) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(language === "zh" ? "zh-CN" : language, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "";
  const card = (item: WatchedItem) => <li key={item.id} className={`watched-card${item.done ? "" : " is-later"}`} data-testid="watched-item">
    <strong>{item.title}</strong>
    {item.date && item.done && <small>{day(item.date)}</small>}
    {item.text && <p>{item.text}</p>}
  </li>;
  return <section className="watched" data-testid="watched-shelf">
    <header className="watched-head">
      <span className="watched-icon" aria-hidden="true"><FilmSlate size={26} weight="fill" /></span>
      <div><h2>{t("我们一起看过的", "What we've watched together", "Lo que hemos visto juntos")}</h2>
        <small>{watched.length ? t(`一起看过 ${watched.length} 部`, `${watched.length} watched together`, `${watched.length} vistos juntos`) : t("跟 Pinky 说一声，就会记在这里", "Tell Pinky and it lands here", "Cuéntaselo a Pinky y aparece aquí")}</small></div>
    </header>
    <div className="watched-actions">
      <button type="button" onClick={() => onAsk(t("我们昨晚一起看了", "Last night we watched ", "Anoche vimos "))}>{t("记一部看过的", "Add one we watched", "Añadir una vista")}</button>
      <button type="button" onClick={() => onAsk(t("今晚我们一起看什么？", "What should we watch together tonight?", "¿Qué vemos juntos esta noche?"))}><Popcorn size={16} weight="fill" />{t("今晚看什么", "What tonight?", "¿Qué vemos hoy?")}</button>
    </div>
    {!!later.length && <><h3>{t("在追 · 想一起看", "Watching · want to watch", "Viendo · queremos ver")}</h3><ul className="watched-list">{later.map(card)}</ul></>}
    {!!watched.length && <><h3>{t("看过的", "Watched", "Vistos")}</h3><ul className="watched-list">{watched.map(card)}</ul></>}
    {!items.length && <div className="moments-empty"><strong>{t("还没有记下看过的剧和电影", "Nothing here yet", "Aún no hay nada")}</strong><p>{t("在“我们俩”里说“我们看完了《请回答1988》”，或者约好“周六一起看第 13 集”，Pinky 会帮你们记着；第二天还会问一句看完了没有。", "In Us, say \"we finished Reply 1988\" or plan \"let's watch episode 13 on Saturday\"; Pinky keeps it, and asks the next day whether you finished.", "En Nosotros, di «terminamos Reply 1988» o queden «veamos el episodio 13 el sábado»; Pinky lo guarda y al día siguiente pregunta si lo terminaron.")}</p></div>}
  </section>;
}

/** Pinky's next-day question in Us, answered by either of them with one tap. */
export function WatchCheckCard({ language, text, answer, members, onAnswer }: { language: Language; text: string; answer?: { by: string; finished: boolean } | null; members: Array<{ id: string; name: string }>; onAnswer: (finished: boolean) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const who = answer ? members.find((member) => member.id === answer.by)?.name || "" : "";
  return <div className="conversation-turn"><div className="watch-check" data-testid="watch-check">
    <p><FilmSlate size={17} weight="fill" />{text}</p>
    {answer ? <small>{answer.finished ? t(`${who} 说看完了，已经记进“一起看过的”。`, `${who} said you finished it; it's on your shelf.`, `${who} dijo que la terminaron; ya está en su estante.`) : t(`${who} 说还没看完，下次接着看。`, `${who} said not yet; next time.`, `${who} dijo que aún no; la próxima vez.`)}</small>
      : <div className="watch-check-actions"><button type="button" onClick={() => onAnswer(true)} data-testid="watch-finished">{t("看完了", "Finished", "La terminamos")}</button><button type="button" className="secondary" onClick={() => onAnswer(false)}>{t("还没", "Not yet", "Aún no")}</button></div>}
  </div></div>;
}
