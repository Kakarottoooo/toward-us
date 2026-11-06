import { useCallback, useEffect, useState } from "react";
import { ChatCircleDots, CheckCircle, Circle, LockKey, Trash, UsersThree } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { PageHeader } from "../conversation/ConversationHome";
import { jsonBody, relationshipApi } from "../relationship/api";
import { LedgerView } from "./LedgerView";
import "./spaces.css";

export type SpaceItem = { id: string; title: string; text: string; date: string | null; done: boolean; photoId?: string | null; createdAt: string; version: number };
export type Space = { id: string; title: string; system?: string; layout: "list" | "checklist" | "timeline" | "gallery" | "notes"; description: string; visibility: string; version: number; updatedAt: string; items: SpaceItem[] };

/** One space Pinky built: shown in the layout it chose, with small edits only. New things are asked for in the conversation. */
export function SpacePage({ id, language, onBack, onAsk }: { id: string; language: Language; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const result = await relationshipApi<{ spaces: Space[] }>("/api/spaces"); const found = result.spaces.find((item) => item.id === id) || null; setSpace(found); setError(found ? "" : t("这个空间已经不在了。", "This space is no longer here.", "Este espacio ya no está.")); }
    catch (caught) { setError((caught as Error).message); }
  }, [id, language]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { if (/^space/.test(JSON.parse((event as MessageEvent).data).eventType)) void load(); } catch { /* Ignore malformed events. */ } });
    return () => events.close();
  }, [load]);
  const change = async (item: SpaceItem, fields: Partial<SpaceItem>) => {
    setSpace((current) => current && { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, ...fields } : entry) });
    try { await relationshipApi(`/api/space-items/${item.id}`, { ...jsonBody(fields), method: "PATCH" }); } catch (caught) { setError((caught as Error).message); void load(); }
  };
  const remove = async (item: SpaceItem) => {
    if (confirming !== item.id) { setConfirming(item.id); return; }
    setConfirming(null); setSpace((current) => current && { ...current, items: current.items.filter((entry) => entry.id !== item.id) });
    try { await relationshipApi(`/api/space-items/${item.id}/archive`, jsonBody({})); } catch (caught) { setError((caught as Error).message); void load(); }
  };
  const shared = space?.visibility === "shared";
  const dateText = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "short", day: "numeric", year: date.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric", timeZone: "UTC" });
  const removeButton = (item: SpaceItem) => <button className={`space-remove ${confirming === item.id ? "confirming" : ""}`} onClick={() => void remove(item)} aria-label={t("删除", "Delete", "Eliminar")}>{confirming === item.id ? t("确认删除", "Delete", "Eliminar") : <Trash size={18} />}</button>;
  const items = space?.items || [];
  const timeline = [...items].sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
  const months = timeline.reduce<Array<{ label: string; items: SpaceItem[] }>>((groups, item) => {
    const date = item.date || item.createdAt.slice(0, 10);
    const label = new Date(`${date.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", timeZone: "UTC" });
    const last = groups.at(-1); if (last?.label === label) last.items.push(item); else groups.push({ label, items: [item] }); return groups;
  }, []);
  const body = () => {
    if (!space) return null;
    if (!items.length) return <p className="space-empty">{t("这里还是空的。回到对话，跟 Pinky 说要放什么。", "Nothing here yet. Tell Pinky in the chat what to add.", "Aún no hay nada. Dile a Pinky en el chat qué añadir.")}</p>;
    if (space.layout === "checklist") {
      const open = items.filter((item) => !item.done), done = items.filter((item) => item.done);
      const row = (item: SpaceItem) => <li key={item.id} className={item.done ? "done" : ""}><button className="space-check" onClick={() => void change(item, { done: !item.done })} aria-pressed={item.done} aria-label={item.title || item.text}>{item.done ? <CheckCircle size={24} weight="fill" /> : <Circle size={24} />}</button><div><strong>{item.title || item.text}</strong>{item.title && item.text && <p>{item.text}</p>}{item.date && <small>{dateText(item.date)}</small>}</div>{removeButton(item)}</li>;
      return <><ul className="space-checklist">{open.map(row)}</ul>{!!done.length && <><h2 className="space-subhead">{t(`已完成 ${done.length}`, `Done ${done.length}`, `Hecho ${done.length}`)}</h2><ul className="space-checklist">{done.map(row)}</ul></>}</>;
    }
    if (space.layout === "timeline") return <div className="space-timeline">{months.map((group) => <section key={group.label}><h2 className="space-subhead">{group.label}</h2><ol>{group.items.map((item) => <li key={item.id}><span className="space-dot" aria-hidden="true" /><div>{item.date && <small>{dateText(item.date)}</small>}<strong>{item.title || item.text}</strong>{item.title && item.text && <p>{item.text}</p>}</div>{removeButton(item)}</li>)}</ol></section>)}</div>;
    if (space.layout === "gallery") return <div className="space-gallery">{timeline.map((item) => <figure key={item.id}>{item.photoId ? <img src={`/api/photos/${item.photoId}`} alt={item.title || item.text} loading="lazy" draggable={false} /> : <div className="space-tile">{item.title || item.text}</div>}<figcaption><span>{item.title || item.text}</span>{item.date && <small>{dateText(item.date)}</small>}</figcaption>{removeButton(item)}</figure>)}</div>;
    if (space.layout === "notes") return <div className="space-notes">{timeline.map((item) => <article key={item.id}>{item.title && <h2>{item.title}</h2>}{item.text && <p>{item.text}</p>}<footer>{item.date && <small>{dateText(item.date)}</small>}{removeButton(item)}</footer></article>)}</div>;
    return <ul className="space-list">{items.map((item) => <li key={item.id}><div><strong>{item.title || item.text}</strong>{item.title && item.text && <p>{item.text}</p>}{item.date && <small>{dateText(item.date)}</small>}</div>{removeButton(item)}</li>)}</ul>;
  };
  return <div className="paper-screen relationship-shell space-screen" data-testid="space-screen">
    <PageHeader language={language} title={space?.title || ""} onBack={onBack} />
    <main className="relationship-main space-main">
      {space && <p className="space-scope">{shared ? <><UsersThree size={16} />{t("你们俩都能看到", "Both of you can see this", "Los dos pueden verlo")}</> : <><LockKey size={16} />{t("只有你能看到", "Only you can see this", "Solo tú puedes verlo")}</>}</p>}
      {space?.description && <p className="space-description">{space.description}</p>}
      {error && <p className="space-error" role="alert">{error}</p>}
      {space?.system === "ledger" ? <LedgerView id={space.id} language={language} onError={setError} /> : body()}
      {space && <button className="space-ask" onClick={() => onAsk(space.system === "ledger" ? t("Pinky 记一笔：", "Pinky, note an expense: ", "Pinky, anota un gasto: ") : t(`往“${space.title}”里加：`, `Add to "${space.title}": `, `Añade a «${space.title}»: `), shared ? "us" : "me")}><ChatCircleDots size={20} weight="fill" />{t("跟 Pinky 说", "Tell Pinky", "Díselo a Pinky")}</button>}
    </main>
  </div>;
}
