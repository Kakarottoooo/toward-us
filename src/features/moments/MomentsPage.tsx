import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FilmSlate, GlobeHemisphereWest, LockKey, Plus, Sparkle, Trash, UsersThree } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { anniversariesOf, firstsOf, holidaysOf, placesOf, tripsOf, yearsOf, type Milestone, type Moment, type Place, type Story } from "./browse";
import { IdeasSection } from "./IdeasSection";
import { WatchedShelf, type WatchedItem } from "./WatchedShelf";
import { PhotoAlbumCard } from "./PhotoAlbumCard";
import { photoPlugin } from "./photoAlbum";
import { StoryViewer, type Slide } from "./StoryViewer";
import "./moments.css";

// The map library is only loaded when someone opens the map.
const MemoriesMap = lazy(() => import("./MemoriesMap").then((module) => ({ default: module.MemoriesMap })));

type Item = { id: string; title: string; text: string; date: string | null; done?: boolean; photoId?: string | null; idea?: number; photoEvent?: string; createdAt: string; ownerUserId: string };
type Album = { id: string; system?: string; visibility: string; items: Item[] };
type Checkin = { id: string; text: string; mood?: string | null; createdAt: string; ownerUserId: string; visibility: string };
type Scale = "years" | "months" | "all";
type Focus = { title: string; detail?: string; moments: Moment[] };

/** Moments: the couple's memory album and each member's own, photos first (founder 11-05, like Google Photos): stories Pinky
 * found as bubbles that play full screen, the map and search as icons, a photo wall by month, and years / months / every
 * photo at the bottom. Things are added by telling Pinky. */
export function MomentsPage({ language, userId, paired, milestones = [], onAsk }: { language: Language; userId: string; paired: boolean; milestones?: Milestone[]; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [moments, setMoments] = useState<Moment[] | null>(null);
  // Photos first, like Google Photos (founder 11-05): a wall by month; the switch at the bottom zooms out to years or in to every photo.
  const [scale, setScale] = useState<Scale>("months");
  const [mapOpen, setMapOpen] = useState(false);
  // 100 件小事 opens straight from the Us menu or Pinky's suggestion (/?view=moments&ideas=1).
  const [ideasOpen, setIdeasOpen] = useState(() => new URLSearchParams(location.search).get("ideas") === "1");
  // 一起看过的 opens straight from Pinky's card (/?view=moments&watched=1).
  const [watchedOpen, setWatchedOpen] = useState(() => new URLSearchParams(location.search).get("watched") === "1");
  const [watched, setWatched] = useState<WatchedItem[]>([]);
  const [playing, setPlaying] = useState<{ title: string; slides: Slide[] } | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [openYear, setOpenYear] = useState("");
  const [confirming, setConfirming] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [{ spaces }, { checkins }] = await Promise.all([relationshipApi<{ spaces: Album[] }>("/api/spaces"), relationshipApi<{ checkins: Checkin[] }>("/api/checkins").catch(() => ({ checkins: [] as Checkin[] }))]);
      setWatched(spaces.filter((space) => space.system === "watched").flatMap((space) => space.items.map((item) => ({ id: item.id, title: item.title, text: item.text, date: item.date, done: Boolean(item.done), createdAt: item.createdAt }))));
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
  const real = useMemo(() => all.filter((moment) => moment.title || moment.photos.length), [all]);
  const stories = useMemo(() => ({ trips: tripsOf(real, language), holidays: holidaysOf(real, language), days: anniversariesOf(real, milestones, language), firsts: firstsOf(real, language) }), [real, milestones, language]);
  const years = useMemo(() => yearsOf(real), [real]);
  const places = useMemo(() => placesOf(real), [real]);
  const today = new Date().toLocaleDateString("en-CA");
  const onThisDay = all.filter((moment) => moment.date.slice(5) === today.slice(5) && moment.date < today);
  const day = (date: string, withYear = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  const mood = (value?: string | null) => value === "low" ? t("有点低落", "Feeling low", "Con poco ánimo") : value === "mixed" ? t("说不清", "Mixed", "Mezclado") : value === "okay" ? t("还好", "Okay", "Bien") : value === "good" ? t("很好", "Good", "Muy bien") : "";
  const photo = (id: string | null, className = "", width = 240) => id ? <img className={className} decoding="async" src={`/api/photos/${encodeURIComponent(id)}?w=${width}`} alt="" loading="lazy" draggable={false} /> : <span className={`${className} moments-nophoto`} aria-hidden="true" />;
  const photos = (ids: string[]) => <div className={`moment-photos count-${Math.min(ids.length, 3)}`}>{ids.slice(0, 6).map((id) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img decoding="async" src={`/api/photos/${encodeURIComponent(id)}?w=480`} alt="" loading="lazy" draggable={false} /></a>)}</div>;
  // Ideas done together: the oldest shared memory that names one ticks it, with its first photo.
  const done = new Map<number, { photo: string | null; date: string }>();
  for (const moment of [...all].reverse()) if (moment.idea && !done.has(moment.idea)) done.set(moment.idea, { photo: moment.photos[0] || null, date: moment.date });
  const ask = () => onAsk(t("帮我存一个回忆：", "Keep a memory for us: ", "Guarda un recuerdo: "), paired ? "us" : "me");
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

  const mapLabels = { globe: t("地球", "Globe", "Globo"), flat: t("平面", "Flat", "Plano"), loading: t("正在打开地图…", "Opening the map…", "Abriendo el mapa…"), failed: t("地图没加载出来，稍后再试。", "The map didn't load. Try again later.", "El mapa no cargó. Inténtalo más tarde.") };
  const count = (n: number) => t(`${n} 段`, `${n} memories`, `${n} recuerdos`);
  const openPlace = (place: Place) => go({ title: place.title, detail: count(place.moments.length), moments: place.moments });
  const openMoment = (moment: Moment) => go({ title: moment.title || day(moment.date, true), detail: day(moment.date, true), moments: [moment] });
  const monthTitle = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", timeZone: "UTC" });
  const back = <button type="button" className="moments-back" onClick={() => { setFocus(null); setIdeasOpen(false); }}><ArrowLeft size={18} />{mapOpen ? t("地图", "Map", "Mapa") : t("回忆", "Memories", "Recuerdos")}</button>;

  if (focus) return <div className="moments-page" data-testid="moments-focus">
    {back}
    <header className="moments-focus-head"><h2>{focus.title}</h2>{focus.detail && <small>{focus.detail}</small>}</header>
    {timeline(focus.moments)}
  </div>;

  if (watchedOpen) return <div className="moments-page" data-testid="moments-watched">
    <button type="button" className="moments-back" onClick={() => setWatchedOpen(false)}><ArrowLeft size={18} />{t("回忆", "Memories", "Recuerdos")}</button>
    <WatchedShelf language={language} items={watched} onAsk={(text) => onAsk(text, "us")} />
  </div>;

  if (ideasOpen) return <div className="moments-page" data-testid="moments-ideas">
    {back}
    <IdeasSection language={language} done={done} onDid={(text) => onAsk(text, "us")} onPlan={(text) => onAsk(text, "us")} />
  </div>;

  // The map is its own page, opened from the globe at the top right (founder 11-05).
  // The map fills the page under the app header, with the way back and the title floating on it (founder 11-06: the two
  // header rows above a small map wasted the screen).
  if (mapOpen) return <div className="moments-map-page" data-testid="moments-map">
    {places.length ? <Suspense fallback={<p className="moments-note">{mapLabels.loading}</p>}>
      <MemoriesMap places={places} language={language} label={t("你们一起去过的地方", "Places you've been together", "Lugares donde han estado juntos")} labels={mapLabels} onOpen={openPlace} />
    </Suspense> : <div className="moments-empty"><strong>{t("地图上还没有地方", "No places yet", "Aún no hay lugares")}</strong><p>{t("连接 iPhone 相册后，带地点的照片会出现在这里。", "Connect your iPhone album and photos with a place appear here.", "Conecta tu álbum del iPhone y las fotos con lugar aparecerán aquí.")}</p></div>}
    <div className="moments-map-top">
      <button type="button" className="moments-map-back" onClick={() => setMapOpen(false)} aria-label={t("返回回忆", "Back to memories", "Volver a recuerdos")}><ArrowLeft size={20} weight="bold" /></button>
      <div className="moments-map-title"><strong>{t("我们的足迹", "Where we've been", "Donde hemos estado")}</strong><small>{t(`一起去过 ${places.length} 个地方`, `${places.length} places together`, `${places.length} lugares juntos`)}</small></div>
    </div>
  </div>;

  // Stories Pinky found, as round bubbles at the top; each plays full screen.
  const bubbles: Story[] = [
    ...(onThisDay.length ? [{ id: "onthisday", kind: "first" as const, title: t("往年的今天", "On this day", "Un día como hoy"), detail: "", moments: onThisDay, cover: onThisDay.find((moment) => moment.photos.length)?.photos[0] || null }] : []),
    ...stories.trips.slice(0, 6), ...stories.days, ...stories.holidays,
    ...years.slice(0, 3).map((year) => ({ id: `year:${year.year}`, kind: "year" as const, title: t(`我们的 ${year.year}`, `Our ${year.year}`, `Nuestro ${year.year}`), detail: count(year.moments.length), moments: year.moments, cover: year.cover })),
    ...stories.firsts.slice(0, 6),
  ];
  const play = (story: Story) => setPlaying({ title: story.title, slides: [...story.moments].sort((a, b) => a.date.localeCompare(b.date)).flatMap((moment) => (moment.photos.length ? moment.photos.slice(0, 4) : [null]).map((photo, at) => ({ photo, title: at ? "" : moment.title, date: day(moment.date, true), text: at ? "" : moment.text }))).slice(0, 40) });
  const year = years.find((item) => item.year === openYear);
  const wallOf = (list: Moment[]) => {
    const months = new Map<string, Moment[]>();
    for (const moment of list) { const key = moment.date.slice(0, 7); if (!months.has(key)) months.set(key, []); months.get(key)!.push(moment); }
    return [...months].sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => {
      const where = [...new Set(items.filter((moment) => typeof moment.lat === "number").map((moment) => moment.title))].slice(0, 2);
      return <section key={key} className="photo-wall-month">
        <h3>{monthTitle(key)}{where.length ? <small> · {where.join(t("、", ", ", ", "))}</small> : null}</h3>
        <div className="photo-wall">{items.map((moment) => <button key={moment.key} type="button" className={moment.photos.length ? "photo-tile" : "photo-tile is-text"} onClick={() => openMoment(moment)}>
          {moment.photos.length ? <img decoding="async" src={`/api/photos/${encodeURIComponent(moment.photos[0])}?w=480`} alt="" loading="lazy" draggable={false} /> : <span className="photo-tile-text">{moment.title || moment.text}</span>}
          {moment.photos.length > 1 && <em>{moment.photos.length}</em>}
          {!moment.shared && <LockKey className="photo-tile-lock" size={14} weight="fill" />}
        </button>)}</div>
      </section>;
    });
  };
  const everyPhoto = (list: Moment[]) => {
    const months = new Map<string, Array<{ id: string; moment: Moment }>>();
    for (const moment of list) for (const id of moment.photos) { const key = moment.date.slice(0, 7); if (!months.has(key)) months.set(key, []); months.get(key)!.push({ id, moment }); }
    return [...months].sort((a, b) => b[0].localeCompare(a[0])).map(([key, items]) => <section key={key} className="photo-wall-month">
      <h3>{monthTitle(key)}</h3>
      <div className="photo-wall is-dense">{items.map(({ id, moment }) => <button key={id} type="button" className="photo-tile" onClick={() => openMoment(moment)}><img decoding="async" src={`/api/photos/${encodeURIComponent(id)}?w=240`} alt="" loading="lazy" draggable={false} /></button>)}</div>
    </section>);
  };
  const scales: Array<[Scale, string]> = [["years", t("年", "Years", "Años")], ["months", t("月", "Months", "Meses")], ["all", t("全部", "All", "Todo")]];

  return <div className="moments-page is-photos" data-testid="moments-page">
    <div className="moments-toolbar">
    <div className="moments-icons">
        <button type="button" className="moments-find" onClick={ask} aria-label={t("跟 Pinky 说一个回忆", "Tell Pinky a memory", "Cuéntale un recuerdo a Pinky")}><Plus size={18} weight="bold" /><span>{t("记一个回忆", "Add", "Añadir")}</span></button>
        <button type="button" className="moments-find" onClick={(event) => { (event.currentTarget.closest(".relationship-main") as HTMLElement | null)?.scrollTo({ top: 0 }); setMapOpen(true); }} aria-label={t("我们的足迹（地图）", "Where we've been (map)", "Donde hemos estado (mapa)")} data-testid="open-map"><GlobeHemisphereWest size={18} /><span>{t("地图", "Map", "Mapa")}</span></button>
      </div>
    </div>
    <div className="moments-top">
      {/* Native sideways scrolling (founder 11-07, "还是有点卡"): the phone moves this row itself instead of following each touch in
          code, the one exception to using Carousel; vertical swipes on it still scroll the page. */}
      <div role="group" aria-label={t("Pinky 找到的故事", "Stories Pinky found", "Historias que encontró Pinky")} className="story-bubbles story-bubbles-native"><div className="story-bubbles-track">
        {bubbles.map((story) => <button key={story.id} type="button" className="story-bubble" onClick={() => play(story)} data-testid={`story-${story.kind}`}>
          <span className="story-bubble-ring">{photo(story.cover, "story-bubble-photo")}</span><span className="story-bubble-label">{story.title}</span>
        </button>)}
        {paired && <button type="button" className="story-bubble" onClick={() => setIdeasOpen(true)} data-testid="open-ideas">
          <span className="story-bubble-ring is-ideas"><Sparkle size={26} weight="fill" /></span><span className="story-bubble-label">{t("100 件小事", "100 little things", "100 cosas")}</span>
        </button>}
        {paired && <button type="button" className="story-bubble" onClick={() => setWatchedOpen(true)} data-testid="open-watched">
          <span className="story-bubble-ring is-watched"><FilmSlate size={26} weight="fill" /></span><span className="story-bubble-label">{t("一起看过的", "Watched", "Vistos")}</span>
        </button>}
      </div></div>
    </div>
    {error && <p className="space-error" role="alert">{error}</p>}

    {scale === "years" && !year && <div className="year-grid">{years.map((item) => <button key={item.year} type="button" onClick={() => setOpenYear(item.year)} data-testid={`year-${item.year}`}>
      {photo(item.cover, "year-cover", 480)}
      <span><strong>{item.year}</strong><small>{count(item.moments.length)}{item.places.length ? ` · ${item.places.slice(0, 3).join(t("、", ", ", ", "))}` : ""}</small></span>
    </button>)}</div>}
    {scale === "years" && year && <>
      <button type="button" className="moments-back" onClick={() => setOpenYear("")}><ArrowLeft size={18} />{t("所有年份", "All years", "Todos los años")}</button>
      {wallOf(year.moments)}
    </>}
    {scale === "months" && wallOf(all)}
    {scale === "all" && everyPhoto(all)}
    {moments && !all.length && <div className="moments-empty"><strong>{t("还没有回忆", "No moments yet", "Aún no hay recuerdos")}</strong><p>{t("约会、旅行、第一次、让你感动的小事……在对话里跟 Pinky 说，或者发几张照片说“存进回忆”，就会出现在这里。", "Dates, trips, firsts, small things that moved you: tell Pinky in the chat, or send photos and say “keep this”, and they appear here.", "Citas, viajes, primeras veces, pequeños detalles: díselo a Pinky en el chat, o envía fotos y di «guárdalo», y aparecerán aquí.")}</p></div>}

    {paired && photoPlugin() && <PhotoAlbumCard language={language} />}
    {!!all.length && <div className="moments-scale" role="tablist" aria-label={t("按时间看", "By time", "Por fecha")}>{scales.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={scale === value} className={scale === value ? "active" : ""} onClick={() => { setScale(value); setOpenYear(""); }}>{label}</button>)}</div>}
    {playing && <StoryViewer title={playing.title} slides={playing.slides} closeLabel={t("关闭", "Close", "Cerrar")} onClose={() => setPlaying(null)} />}
  </div>;
}
