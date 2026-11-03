import { useEffect } from "react";
import { Sparkle, X } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import "./story.css";

export type Story = { title: string; subtitle: string; coverPhotoId: string | null; stats: Array<{ label: string; value: string }>; chapters: Array<{ heading: string; text: string; date: string | null; photoId: string | null }>; closing: string; occasion?: string };
const photo = (id: string) => `/api/photos/${encodeURIComponent(id)}`;

/** A recap Pinky made, as it appears in Us: a cover to open. */
export function StoryCard({ language, story, onOpen }: { language: Language; story: Story; onOpen: () => void }) {
  const cover = story.coverPhotoId || story.chapters.find((chapter) => chapter.photoId)?.photoId || null;
  return <button type="button" className={`story-card ${cover ? "has-cover" : ""}`} onClick={onOpen} data-testid="story-card">
    {cover && <img src={photo(cover)} alt="" draggable={false} />}
    <span className="story-card-text"><small><Sparkle size={14} weight="fill" />{localized(language, "Pinky 为你们做的", "Made by Pinky for you", "Hecho por Pinky para ustedes")}</small><strong>{story.title}</strong><em>{story.subtitle}</em><b>{localized(language, "打开看看", "Open", "Abrir")}</b></span>
  </button>;
}

/** The recap opened over the conversation: cover, a few numbers, the chapters with their photos, and a closing line. */
export function StoryView({ language, story, onClose }: { language: Language; story: Story; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  const cover = story.coverPhotoId || story.chapters.find((chapter) => chapter.photoId)?.photoId || null;
  const used = new Set(cover ? [cover] : []);
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return <div className="story-view" role="dialog" aria-modal="true" aria-label={story.title} data-testid="story-view">
    <button type="button" className="story-close" onClick={onClose} aria-label={localized(language, "关闭", "Close", "Cerrar")}><X size={22} weight="bold" /></button>
    <div className="story-scroll">
      <header className={`story-cover ${cover ? "has-cover" : ""}`}>
        {cover && <img src={photo(cover)} alt="" draggable={false} />}
        <div><small>{story.occasion || localized(language, "我们的故事", "Our story", "Nuestra historia")}</small><h1>{story.title}</h1><p>{story.subtitle}</p></div>
      </header>
      {!!story.stats.length && <section className="story-stats">{story.stats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}</section>}
      <ol className="story-chapters">{story.chapters.map((chapter, index) => {
        const show = chapter.photoId && !used.has(chapter.photoId); if (chapter.photoId) used.add(chapter.photoId);
        return <li key={index}>{chapter.date && <small>{day(chapter.date)}</small>}<h2>{chapter.heading}</h2><p>{chapter.text}</p>{show && <img src={photo(chapter.photoId!)} alt="" loading="lazy" draggable={false} />}</li>;
      })}</ol>
      {story.closing && <p className="story-closing">{story.closing}</p>}
      <p className="story-sign">— Pinky</p>
    </div>
  </div>;
}
