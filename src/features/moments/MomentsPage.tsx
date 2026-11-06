import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChatCircleDots, LockKey, MagnifyingGlass, Trash, UsersThree } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { anniversariesOf, firstsOf, holidaysOf, placesOf, tripsOf, yearsOf, type Milestone, type Moment, type Place, type Story } from "./browse";
import { IdeasSection } from "./IdeasSection";
import { PhotoAlbumCard } from "./PhotoAlbumCard";
import { photoPlugin } from "./photoAlbum";
import "./moments.css";

// The map library is only loaded when someone opens the map.
const MemoriesMap = lazy(() => import("./MemoriesMap").then((module) => ({ default: module.MemoriesMap })));

type Item = { id: string; title: string; text: string; date: string | null; photoId?: string | null; idea?: number; photoEvent?: string; createdAt: string; ownerUserId: string };
type Album = { id: string; system?: string; visibility: string; items: Item[] };
type Checkin = { id: string; text: string; mood?: string | null; createdAt: string; ownerUserId: string; visibility: string };
type Filter = "all" | "us" | "me";
type Mode = "featured" | "years" | "map" | "all";
type Focus = { title: string; detail?: string; moments: Moment[] };

/** Moments: the couple's memory album and each member's own. Opens on stories Pinky found, zooms by year and month, filters
 * by topic, shows a map, and keeps the full timeline one tap away. Things are added by telling Pinky. */
export function MomentsPage({ language, userId, paired, milestones = [], onAsk }: { language: Language; userId: string; paired: boolean; milestones?: Milestone[]; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<Mode>("featured");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [openYear, setOpenYear] = useState("");
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
        // A memory made from a phone album carries where it was taken in its key ("day|lat,lon").
        const spot = /\|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(item.photoEvent || "");
        if (spot && moment.lat === undefined) { moment.lat = Number(spot[1]); moment.lon = Number(spot[2]); }
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

  const all = moments || [];
  const visible = all.filter((moment) => filter === "all" || (filter === "us" ? moment.shared : !moment.shared));
  const real = useMemo(() => all.filter((moment) => moment.title || moment.photos.length), [all]);
  const stories = useMemo(() => ({ trips: tripsOf(real, language), holidays: holidaysOf(real, language), days: anniversariesOf(real, milestones, language), firsts: firstsOf(real, language) }), [real, milestones, language]);
  const years = useMemo(() => yearsOf(real), [real]);
  const places = useMemo(() => placesOf(real), [real]);
  const today = new Date().toLocaleDateString("en-CA");
  const onThisDay = all.filter((moment) => moment.date.slice(5) === today.slice(5) && moment.date < today);
  const day = (date: string, withYear = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  const monthName = (month: string) => new Date(`2000-${month}-15T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "short", timeZone: "UTC" });
  const mood = (value?: string | null) => value === "low" ? t("有点低落", "Feeling low", "Con poco ánimo") : value === "mixed" ? t("说不清", "Mixed", "Mezclado") : value === "okay" ? t("还好", "Okay", "Bien") : value === "good" ? t("很好", "Good", "Muy bien") : "";
  const photo = (id: string | null, className = "") => id ? <img className={className} src={`/api/photos/${encodeURIComponent(id)}`} alt="" loading="lazy" draggable={false} /> : <span className={`${className} moments-nophoto`} aria-hidden="true" />;
  const photos = (ids: string[]) => <div className={`moment-photos count-${Math.min(ids.length, 3)}`}>{ids.slice(0, 6).map((id) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/photos/${encodeURIComponent(id)}`} alt="" loading="lazy" draggable={false} /></a>)}</div>;
  // Ideas done together: the oldest shared memory that names one ticks it, with its first photo.
  const done = new Map<number, { photo: string | null; date: string }>();
  for (const moment of [...all].reverse()) if (moment.idea && !done.has(moment.idea)) done.set(moment.idea, { photo: moment.photos[0] || null, date: moment.date });
  const ask = () => onAsk(t("帮我存一个回忆：", "Keep a memory for us: ", "Guarda un recuerdo: "), paired && filter !== "me" ? "us" : "me");
  const find = () => onAsk(t("帮我找一段回忆：", "Find a memory for us: ", "Busca un recuerdo: "), paired ? "us" : "me");
  const go = (next: Focus) => { setFocus(next); window.scrollTo?.({ top: 0 }); };

  const timeline = (list: Moment[]) => {
    const groups = [...new Set(list.map((moment) => moment.date.slice(0, 4)))];
    return groups.map((year) => <section key={year} className="moments-year"><h2>{year}</h2><ol>{list.filter((moment) => moment.date.startsWith(year)).map((moment) => <li key={moment.key} className="moment">
      <span className="moment-dot" aria-hidden="true" />
      <div className="moment-body">
        <small>{day(moment.date)}{moment.shared ? <span className="moment-scope"><UsersThree size={13} />{t("我们俩的", "Ours", "Nuestro")}</span> : <span className="moment-scope"><LockKey size={13} />{t("只有我", "Just me", "Solo yo")}</span>}</small>
        {moment.title && <strong>{moment.title}</strong>}
        {moment.text && <p>{moment.text}</p>}
        {moment.mood && <em>{t("心情：", "Feeling: ", "Ánimo: ")}{mood(moment.mood)}</em>}
        {!!moment.photos.length && photos(moment.photos)}
      </div>
      {moment.ids.length > 0 && moment.mine && <button type="button" className={`space-remove ${confirming === moment.key ? "confirming" : ""}`} onClick={() => void remove(moment)} aria-label={t("删除", "Delete", "Eliminar")}>{confirming === moment.key ? t("确认删除", "Delete", "Eliminar") : <Trash size={18} />}</button>}
    </li>)}</ol></section>);
  };
  const card = (story: Story) => <button key={story.id} type="button" className={`memory-story is-${story.kind}`} onClick={() => go({ title: story.title, detail: story.detail, moments: story.moments })} data-testid={`story-${story.kind}`}>
    {photo(story.cover, "memory-story-cover")}
    <span className="memory-story-text"><small>{story.kind === "trip" ? t("旅行", "Trip", "Viaje") : story.kind === "holiday" ? t("每年的节日", "Every year", "Cada año") : story.kind === "anniversary" ? t("纪念日", "Special day", "Día especial") : story.kind === "first" ? t("第一次", "First time", "Primera vez") : t("年度回忆", "Year", "Año")} · {story.detail}</small><strong>{story.title}</strong></span>
  </button>;

  if (focus) return <div className="moments-page" data-testid="moments-focus">
    <button type="button" className="moments-back" onClick={() => setFocus(null)}><ArrowLeft size={18} />{t("回忆", "Memories", "Recuerdos")}</button>
    <header className="moments-focus-head"><h2>{focus.title}</h2>{focus.detail && <small>{focus.detail}</small>}</header>
    {timeline(focus.moments)}
  </div>;

  const featured: Story[] = [...stories.trips.slice(0, 4), ...stories.days, ...stories.holidays, ...years.slice(0, 2).map((year) => ({ id: `year:${year.year}`, kind: "year" as const, title: t(`我们的 ${year.year}`, `Our ${year.year}`, `Nuestro ${year.year}`), detail: t(`${year.moments.length} 段`, `${year.moments.length} memories`, `${year.moments.length} recuerdos`), moments: year.moments, cover: year.cover })), ...stories.firsts.slice(0, 4)];
  const topics: Array<{ id: string; label: string; moments: Moment[] }> = [
    { id: "trips", label: t("旅行", "Trips", "Viajes"), moments: [...new Set(stories.trips.flatMap((story) => story.moments))] },
    { id: "holidays", label: t("节日", "Holidays", "Fiestas"), moments: [...new Set(stories.holidays.flatMap((story) => story.moments))] },
    { id: "days", label: t("纪念日·生日", "Anniversaries", "Aniversarios"), moments: [...new Set(stories.days.flatMap((story) => story.moments))] },
    { id: "ideas", label: t("100 件小事", "100 little things", "100 cosas"), moments: all.filter((moment) => moment.idea) },
  ].filter((topic) => topic.moments.length);
  const year = years.find((item) => item.year === openYear);
  const modes: Array<[Mode, string]> = [["featured", t("精选", "Featured", "Destacados")], ["years", t("年", "Years", "Años")], ["map", t("地图", "Map", "Mapa")], ["all", t("全部", "All", "Todo")]];

  return <div className="moments-page" data-testid="moments-page">
    <div className="moments-modes">
      <div className="moments-tabs" role="tablist" aria-label={t("怎么看回忆", "How to browse", "Cómo ver")}>{modes.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setOpenYear(""); }}>{label}</button>)}</div>
      <button type="button" className="moments-find" onClick={find} aria-label={t("问 Pinky 找回忆", "Ask Pinky to find a memory", "Pide a Pinky un recuerdo")}><MagnifyingGlass size={18} /></button>
    </div>
    {error && <p className="space-error" role="alert">{error}</p>}

    {mode === "featured" && <>
      {!!onThisDay.length && <button type="button" className="moments-onthisday" onClick={() => go({ title: t("往年的今天", "On this day", "Un día como hoy"), moments: onThisDay })}><small>{t("往年的今天", "On this day", "Un día como hoy")}</small>{onThisDay.slice(0, 2).map((moment) => <div key={moment.key}>{moment.photos[0] && <img loading="lazy" src={`/api/photos/${encodeURIComponent(moment.photos[0])}`} alt="" draggable={false} />}<span><strong>{moment.title || moment.text}</strong><small>{day(moment.date, true)}</small></span></div>)}</button>}
      {!!featured.length && <section className="memory-stories" aria-label={t("Pinky 找到的故事", "Stories Pinky found", "Historias que encontró Pinky")}>{featured.map(card)}</section>}
      {!!topics.length && <div className="moments-topics" role="group" aria-label={t("按主题看", "By topic", "Por tema")}>
        {topics.map((topic) => <button key={topic.id} type="button" onClick={() => go({ title: topic.label, detail: t(`${topic.moments.length} 段`, `${topic.moments.length} memories`, `${topic.moments.length} recuerdos`), moments: [...topic.moments].sort((a, b) => b.date.localeCompare(a.date)) })}>{topic.label}</button>)}
        {places.slice(0, 8).map((place) => <button key={`${place.title}${place.lat}`} type="button" onClick={() => go({ title: place.title, detail: t(`${place.moments.length} 段`, `${place.moments.length} memories`, `${place.moments.length} recuerdos`), moments: place.moments })}>{place.title}</button>)}
      </div>}
      {paired && photoPlugin() && <PhotoAlbumCard language={language} />}
      {paired && <IdeasSection language={language} done={done} onDid={(text) => onAsk(text, "us")} />}
      {!!visible.length && <section className="moments-recent"><h2>{t("最近", "Recent", "Recientes")}</h2></section>}
      {!!visible.length && timeline(visible.slice(0, 5))}
      {visible.length > 5 && <button type="button" className="moments-more" onClick={() => setMode("all")}>{t(`看全部 ${visible.length} 段`, `See all ${visible.length}`, `Ver los ${visible.length}`)}</button>}
      {moments && !all.length && <section className="moments-empty"><strong>{t("还没有回忆", "No moments yet", "Aún no hay recuerdos")}</strong><p>{t("约会、旅行、第一次、让你感动的小事……在对话里跟 Pinky 说，或者发几张照片说“存进回忆”，就会出现在这里。", "Dates, trips, firsts, small things that moved you: tell Pinky in the chat, or send photos and say “keep this”, and they appear here.", "Citas, viajes, primeras veces, pequeños detalles: díselo a Pinky en el chat, o envía fotos y di «guárdalo», y aparecerán aquí.")}</p></section>}
    </>}

    {mode === "years" && !year && <section className="year-grid">{years.map((item) => <button key={item.year} type="button" onClick={() => setOpenYear(item.year)} data-testid={`year-${item.year}`}>
      {photo(item.cover, "year-cover")}
      <span><strong>{item.year}</strong><small>{t(`${item.moments.length} 段`, `${item.moments.length} memories`, `${item.moments.length} recuerdos`)}{item.places.length ? ` · ${item.places.slice(0, 3).join(t("、", ", ", ", "))}` : ""}</small></span>
    </button>)}</section>}
    {mode === "years" && year && <>
      <button type="button" className="moments-back" onClick={() => setOpenYear("")}><ArrowLeft size={18} />{t("所有年份", "All years", "Todos los años")}</button>
      <header className="moments-focus-head"><h2>{year.year}</h2><small>{t(`${year.moments.length} 段回忆`, `${year.moments.length} memories`, `${year.moments.length} recuerdos`)}{year.places.length ? ` · ${year.places.slice(0, 5).join(t("、", ", ", ", "))}` : ""}</small></header>
      <section className="month-grid">{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((month) => {
        const list = year.months.get(month) || [];
        return <button key={month} type="button" disabled={!list.length} onClick={() => go({ title: `${year.year} · ${monthName(month)}`, detail: t(`${list.length} 段`, `${list.length} memories`, `${list.length} recuerdos`), moments: [...list].sort((a, b) => b.date.localeCompare(a.date)) })}>
          {photo(list.find((moment) => moment.photos.length)?.photos[0] || null, "month-cover")}<span><strong>{monthName(month)}</strong>{!!list.length && <small>{list.length}</small>}</span>
        </button>;
      })}</section>
    </>}

    {mode === "map" && (places.length ? <Suspense fallback={<p className="moments-note">{t("正在打开地图…", "Opening the map…", "Abriendo el mapa…")}</p>}>
      <MemoriesMap places={places} label={t("你们一起去过的地方", "Places you've been together", "Lugares donde han estado juntos")} onOpen={(place: Place) => go({ title: place.title, detail: t(`${place.moments.length} 段`, `${place.moments.length} memories`, `${place.moments.length} recuerdos`), moments: place.moments })} />
      <p className="moments-note">{t(`你们一起去过 ${places.length} 个地方。点照片看那里的回忆。`, `${places.length} places you've been together. Tap a photo to see its memories.`, `${places.length} lugares donde han estado juntos. Toca una foto para ver sus recuerdos.`)}</p>
    </Suspense> : <section className="moments-empty"><strong>{t("地图上还没有地方", "No places yet", "Aún no hay lugares")}</strong><p>{t("连接 iPhone 相册后，带地点的照片会出现在这里。", "Connect your iPhone album and photos with a place appear here.", "Conecta tu álbum del iPhone y las fotos con lugar aparecerán aquí.")}</p></section>)}

    {mode === "all" && <>
      {paired && <div className="moments-filter" role="group" aria-label={t("显示哪些回忆", "Which moments", "Qué recuerdos")}>{(["all", "us", "me"] as Filter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? t("全部", "All", "Todos") : value === "us" ? t("我们俩的", "Ours", "Nuestros") : t("只有我", "Just me", "Solo yo")}</button>)}</div>}
      {timeline(visible)}
    </>}
    <button type="button" className="space-ask" onClick={ask}><ChatCircleDots size={20} weight="fill" />{t("跟 Pinky 说一个回忆", "Tell Pinky a memory", "Cuéntale un recuerdo a Pinky")}</button>
  </div>;
}
