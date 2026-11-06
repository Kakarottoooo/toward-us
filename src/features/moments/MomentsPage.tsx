import { useCallback, useEffect, useState } from "react";
import { ChatCircleDots, LockKey, Trash, UsersThree } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { IdeasSection } from "./IdeasSection";
import { TogetherCard } from "./TogetherCard";
import "./moments.css";

type Item = { id: string; title: string; text: string; date: string | null; photoId?: string | null; idea?: number; createdAt: string; ownerUserId: string };
type Album = { id: string; system?: string; visibility: string; items: Item[] };
type Checkin = { id: string; text: string; mood?: string | null; createdAt: string; ownerUserId: string; visibility: string };
type Moment = { key: string; date: string; title: string; text: string; photos: string[]; ids: string[]; shared: boolean; mine: boolean; mood?: string | null; idea?: number };
type Filter = "all" | "us" | "me";

/** Moments: the couple's memory album and each member's own, as one timeline. Things are added by telling Pinky. */
export function MomentsPage({ language, userId, paired, since = null, onSince, onAsk }: { language: Language; userId: string; paired: boolean; since?: string | null; onSince?: (date: string) => Promise<void>; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirming, setConfirming] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [{ spaces }, { checkins }] = await Promise.all([relationshipApi<{ spaces: Album[] }>("/api/spaces"), relationshipApi<{ checkins: Checkin[] }>("/api/checkins").catch(() => ({ checkins: [] as Checkin[] }))]);
      // Photos of one memory arrive as separate items with the same title and date; they read as one moment.
      const grouped = new Map<string, Moment>();
      for (const album of spaces.filter((space) => space.system === "moments")) for (const item of album.items) {
        const date = item.date || item.createdAt.slice(0, 10), key = `${album.id}|${date}|${item.title || item.id}`;
        const moment = grouped.get(key) || { key, date, title: item.title, text: "", photos: [], ids: [], shared: album.visibility === "shared", mine: item.ownerUserId === userId };
        if (item.text && !moment.text) moment.text = item.text;
        if (item.photoId) moment.photos.push(item.photoId);
        if (item.idea && album.visibility === "shared") moment.idea = item.idea;
        moment.ids.push(item.id); moment.mine = moment.mine && item.ownerUserId === userId; grouped.set(key, moment);
      }
      // Daily check-ins told to Pinky are private moments with a feeling.
      for (const checkin of checkins.filter((item) => item.ownerUserId === userId && item.visibility === "private")) grouped.set(`checkin|${checkin.id}`, { key: `checkin|${checkin.id}`, date: checkin.createdAt.slice(0, 10), title: "", text: checkin.text, photos: [], ids: [], shared: false, mine: true, mood: checkin.mood });
      setMoments([...grouped.values()].sort((a, b) => b.date.localeCompare(a.date))); setError("");
    } catch (caught) { setError((caught as Error).message); setMoments([]); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { if (/^space/.test(JSON.parse((event as MessageEvent).data).eventType)) void load(); } catch { /* Ignore malformed events. */ } });
    return () => events.close();
  }, [load]);
  const remove = async (moment: Moment) => {
    if (confirming !== moment.key) { setConfirming(moment.key); return; }
    setConfirming("");
    try { for (const id of moment.ids) await relationshipApi(`/api/space-items/${id}/archive`, jsonBody({})); await load(); } catch (caught) { setError((caught as Error).message); }
  };
  const today = new Date().toLocaleDateString("en-CA");
  const visible = (moments || []).filter((moment) => filter === "all" || (filter === "us" ? moment.shared : !moment.shared));
  const onThisDay = (moments || []).filter((moment) => moment.date.slice(5) === today.slice(5) && moment.date < today);
  const years = [...new Set(visible.map((moment) => moment.date.slice(0, 4)))];
  const day = (date: string, withYear = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  const mood = (value?: string | null) => value === "low" ? t("有点低落", "Feeling low", "Con poco ánimo") : value === "mixed" ? t("说不清", "Mixed", "Mezclado") : value === "okay" ? t("还好", "Okay", "Bien") : value === "good" ? t("很好", "Good", "Muy bien") : "";
  const photos = (ids: string[]) => <div className={`moment-photos count-${Math.min(ids.length, 3)}`}>{ids.slice(0, 6).map((id) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/photos/${encodeURIComponent(id)}`} alt="" loading="lazy" draggable={false} /></a>)}</div>;
  // Ideas done together: the oldest shared memory that names one ticks it, with its first photo.
  const done = new Map<number, { photo: string | null; date: string }>();
  for (const moment of [...(moments || [])].reverse()) if (moment.idea && !done.has(moment.idea)) done.set(moment.idea, { photo: moment.photos[0] || null, date: moment.date });
  const ask = () => onAsk(t("帮我存一个回忆：", "Keep a memory for us: ", "Guarda un recuerdo: "), paired && filter !== "me" ? "us" : "me");

  return <div className="moments-page" data-testid="moments-page">
    {paired && onSince && <TogetherCard language={language} since={since} onSave={onSince} />}
    {!!onThisDay.length && <section className="moments-onthisday"><small>{t("往年的今天", "On this day", "Un día como hoy")}</small>{onThisDay.slice(0, 2).map((moment) => <div key={moment.key}>{moment.photos[0] && <img src={`/api/photos/${encodeURIComponent(moment.photos[0])}`} alt="" draggable={false} />}<span><strong>{moment.title || moment.text}</strong><small>{day(moment.date, true)}</small></span></div>)}</section>}
    {paired && <IdeasSection language={language} done={done} onDid={(text) => onAsk(text, "us")} />}
    {paired && <div className="moments-filter" role="group" aria-label={t("显示哪些回忆", "Which moments", "Qué recuerdos")}>{(["all", "us", "me"] as Filter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? t("全部", "All", "Todos") : value === "us" ? t("我们俩的", "Ours", "Nuestros") : t("只有我", "Just me", "Solo yo")}</button>)}</div>}
    {error && <p className="space-error" role="alert">{error}</p>}
    {moments && !visible.length && <section className="moments-empty"><strong>{t("还没有回忆", "No moments yet", "Aún no hay recuerdos")}</strong><p>{t("约会、旅行、第一次、让你感动的小事……在对话里跟 Pinky 说，或者发几张照片说“存进回忆”，就会出现在这里。", "Dates, trips, firsts, small things that moved you: tell Pinky in the chat, or send photos and say “keep this”, and they appear here.", "Citas, viajes, primeras veces, pequeños detalles: díselo a Pinky en el chat, o envía fotos y di «guárdalo», y aparecerán aquí.")}</p></section>}
    {years.map((year) => <section key={year} className="moments-year"><h2>{year}</h2><ol>{visible.filter((moment) => moment.date.startsWith(year)).map((moment) => <li key={moment.key} className="moment">
      <span className="moment-dot" aria-hidden="true" />
      <div className="moment-body">
        <small>{day(moment.date)}{moment.shared ? <span className="moment-scope"><UsersThree size={13} />{t("我们俩的", "Ours", "Nuestro")}</span> : <span className="moment-scope"><LockKey size={13} />{t("只有我", "Just me", "Solo yo")}</span>}</small>
        {moment.title && <strong>{moment.title}</strong>}
        {moment.text && <p>{moment.text}</p>}
        {moment.mood && <em>{t("心情：", "Feeling: ", "Ánimo: ")}{mood(moment.mood)}</em>}
        {!!moment.photos.length && photos(moment.photos)}
      </div>
      {moment.ids.length > 0 && moment.mine && <button type="button" className={`space-remove ${confirming === moment.key ? "confirming" : ""}`} onClick={() => void remove(moment)} aria-label={t("删除", "Delete", "Eliminar")}>{confirming === moment.key ? t("确认删除", "Delete", "Eliminar") : <Trash size={18} />}</button>}
    </li>)}</ol></section>)}
    <button type="button" className="space-ask" onClick={ask}><ChatCircleDots size={20} weight="fill" />{t("跟 Pinky 说一个回忆", "Tell Pinky a memory", "Cuéntale un recuerdo a Pinky")}</button>
  </div>;
}
