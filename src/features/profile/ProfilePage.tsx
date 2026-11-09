import { useCallback, useEffect, useState } from "react";
import { CaretRight, FilmSlate, LockSimple, PencilSimple, ShareFat, Sparkle, Trash, Users } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./profile.css";

type Category = "food" | "likes" | "dislikes" | "wishes" | "traits" | "people" | "other";
type Fact = { id: string; version: number; text: string; category: Category; subject: "me" | "partner" | "us"; source: "mine" | "together" | "i_shared" | "partner_shared"; quote: string | null; sharedAt: string | null; updatedAt: string };
const CATEGORIES: Category[] = ["food", "likes", "dislikes", "wishes", "traits", "people", "other"];

type Shelf = { system?: string; visibility: string; items: Array<{ done?: boolean; idea?: number; archivedAt?: string | null }> };
/** 我们一起的 (founder 11-07: "放在关于我们"): the couple's watched-together shelf and their 100 little things, counted, each one
 * tap from here. They used to sit among the photo stories in Memories, which is for photos. */
function TogetherShelves({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [counts, setCounts] = useState<{ watched: number; watching: number; ideas: number } | null>(null);
  useEffect(() => {
    void relationshipApi<{ spaces: Shelf[] }>("/api/spaces").then(({ spaces }) => {
      const shelf = spaces.find((space) => space.system === "watched");
      if (!shelf) { setCounts(null); return; }
      const ideas = new Set(spaces.filter((space) => space.system === "moments" && space.visibility === "shared").flatMap((space) => space.items.map((item) => item.idea).filter(Boolean)));
      setCounts({ watched: shelf.items.filter((item) => item.done).length, watching: shelf.items.filter((item) => !item.done).length, ideas: ideas.size });
    }).catch(() => setCounts(null));
  }, []);
  if (!counts) return null;
  return <section className="settings-group profile-together" data-testid="profile-together">
    <h2>{t("我们一起的", "Ours, together", "Lo nuestro")}</h2>
    <div className="settings-card">
      <button type="button" className="settings-row" onClick={() => location.assign("/?view=moments&watched=1")} data-testid="profile-watched">
        <span className="settings-icon tone-watched"><FilmSlate size={18} weight="fill" /></span>
        <span className="settings-label">{t("一起看过的", "Watched together", "Vistos juntos")}</span>
        <span className="settings-value">{t(`${counts.watched} 部`, `${counts.watched}`, `${counts.watched}`)}{counts.watching ? t(` · 在追 ${counts.watching}`, ` · ${counts.watching} in progress`, ` · ${counts.watching} en curso`) : ""}</span>
        <CaretRight size={16} weight="bold" className="settings-chevron" />
      </button>
      <button type="button" className="settings-row" onClick={() => location.assign("/?view=moments&ideas=1")} data-testid="profile-ideas">
        <span className="settings-icon tone-ideas"><Sparkle size={18} weight="fill" /></span>
        <span className="settings-label">{t("100 件小事", "100 little things", "100 cosas")}</span>
        <span className="settings-value">{counts.ideas} / 100</span>
        <CaretRight size={16} weight="bold" className="settings-chevron" />
      </button>
    </div>
  </section>;
}

/** 关于我们 (喜好档案, founder 11-06): what Pinky keeps about each of them, kept by itself from their conversations. Each
 * person's notes are their own; a line about yourself can be shared, and what was said together in Us belongs to both. */
export function ProfilePage({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [tab, setTab] = useState<"me" | "partner" | "us">("partner");
  const [open, setOpen] = useState<Fact | null>(null);
  const [editing, setEditing] = useState<string | null>(null); const [sharing, setSharing] = useState<{ text: string; digest: string } | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { const result = await relationshipApi<{ facts: Fact[]; partnerName: string | null }>(`/api/profile?language=${language}`); setFacts(result.facts); setPartnerName(result.partnerName); }
    catch (error) { setNotice((error as Error).message); setFacts([]); }
  }, [language]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { if (JSON.parse((event as MessageEvent).data).eventType === "profile.updated") void load(); } catch { /* Ignore malformed events. */ } });
    return () => events.close();
  }, [load]);

  const partner = partnerName || t("TA", "Your partner", "Tu pareja");
  // Before a partner joins, what Pinky learned about TA privately still shows here, to see, correct or remove (11-08).
  const has = (subject: "partner" | "us") => (facts || []).some((fact) => fact.subject === subject);
  const tabs: Array<["me" | "partner" | "us", string]> = partnerName ? [["partner", partner], ["me", t("我", "Me", "Yo")], ["us", t("我们", "Us", "Nosotros")]]
    : [...(has("partner") ? [["partner", partner] as ["partner", string]] : []), ["me", t("我", "Me", "Yo")], ...(has("us") ? [["us", t("我们", "Us", "Nosotros")] as ["us", string]] : [])];
  const shown = tabs.some(([value]) => value === tab) ? tab : tabs[0][0];
  const label: Record<Category, string> = { food: t("吃喝", "Food and drink", "Comida y bebida"), likes: t("喜欢", "Loves", "Le encanta"), dislikes: t("不喜欢 · 雷区", "Dislikes · sore spots", "No le gusta · puntos sensibles"), wishes: t("想要的", "Wishes", "Deseos"), traits: t("性格和习惯", "Traits and habits", "Forma de ser y hábitos"), people: t("重要的人和日子", "People and days that matter", "Personas y fechas importantes"), other: t("其他", "Other", "Otros") };
  const tag = (fact: Fact) => fact.source === "together" ? t("一起说过", "Said together", "Lo dijeron juntos") : fact.source === "partner_shared" ? t(`${partner} 分享的`, `Shared by ${partner}`, `Compartido por ${partner}`) : fact.source === "i_shared" ? t("你分享的副本", "Copy you shared", "Copia que compartiste") : fact.sharedAt ? t("分享过副本", "A copy was shared", "Se compartió una copia") : "";
  const visibility = (fact: Fact) => <span className={`profile-visibility ${fact.source === "mine" ? "is-private" : "is-shared"}`} data-testid="profile-visibility">{fact.source === "mine" ? <LockSimple size={14} /> : <Users size={14} />}{fact.source === "mine" ? t("只有我", "Just me", "Solo yo") : t("我们俩", "Us", "Nosotros")}</span>;
  const list = (facts || []).filter((fact) => fact.subject === shown);
  const close = () => { keyboard.hide(); setOpen(null); setEditing(null); setSharing(null); };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setNotice(""); keyboard.hide();
    try { await action(); close(); await load(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const save = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}`, { method: "PATCH", body: JSON.stringify({ text: editing, expectedVersion: fact.version, language }) }));
  const remove = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: fact.version, language }) }));
  const share = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}/share`, jsonBody({ confirm: true, digest: sharing?.digest, expectedVersion: fact.version, language })));
  const prepareShare = async (fact: Fact) => { setNotice(""); try { setSharing(await relationshipApi<{ text: string; digest: string }>(`/api/profile/${fact.id}/share-preview?language=${language}`)); } catch (error) { setNotice((error as Error).message); } };
  const intro = shown === "partner" ? t(`Pinky 记下的 ${partner} 的喜好和习惯。`, `What Pinky remembers about ${partner}'s likes and habits.`, `Lo que Pinky recuerda de los gustos y hábitos de ${partner}.`)
    : shown === "me" ? t("Pinky 从聊天里了解到的你。", "What Pinky has learned about you.", "Lo que Pinky sabe de ti.")
    : t("Pinky 记下的你们俩的习惯和默契。", "What Pinky remembers about you as a couple.", "Lo que Pinky recuerda de ustedes como pareja.");

  return <div className="profile-page" data-testid="profile-page">
    <TogetherShelves language={language} />
    {tabs.length > 1 && <div className="profile-tabs" role="tablist" aria-label={t("关于谁", "About whom", "Sobre quién")}>{tabs.map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={shown === value} className={shown === value ? "active" : ""} onClick={() => setTab(value)} data-testid={`profile-tab-${value}`}>{name}</button>)}</div>}
    <p className="settings-intro">{intro}</p>
    {facts === null ? <p className="profile-empty" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>
      : !list.length ? <div className="profile-empty"><strong>{t("还没有记下什么", "Nothing yet", "Aún no hay nada")}</strong><p>{t("平时和 Pinky 聊天时提到的喜好、雷区、想要的东西，会自动出现在这里。", "Likes, sore spots and wishes you mention while chatting with Pinky appear here by themselves.", "Los gustos, puntos sensibles y deseos que mencionas al hablar con Pinky aparecen aquí solos.")}</p></div>
      : CATEGORIES.filter((category) => list.some((fact) => fact.category === category)).map((category) => <section key={category} className="settings-group">
        <h2>{label[category]}</h2>
        <div className="settings-card">{list.filter((fact) => fact.category === category).map((fact) => <button key={fact.id} type="button" className="settings-row profile-fact" onClick={() => { setNotice(""); setOpen(fact); setEditing(null); setSharing(null); }} data-testid="profile-fact">
          <span className="profile-fact-content"><span className="profile-fact-text">{fact.text}</span><span className="profile-fact-meta">{visibility(fact)}{tag(fact) && <span>{tag(fact)}</span>}</span></span><CaretRight size={16} aria-hidden="true" />
        </button>)}</div>
      </section>)}
    {notice && !open && <p className="settings-error" role="alert">{notice}</p>}

    <BottomSheet open={Boolean(open)} onOpenChange={(value) => { if (!value) close(); }} title={open?.text || ""} description={open ? label[open.category] : undefined}>
      {open && <div className="profile-sheet">
        {visibility(open)}
        {open.quote && <p className="profile-quote">{open.source === "together" ? t("你们在「我们」里说过：", "Said together in Us:", "Lo dijeron en Nosotros:") : t("你说过：", "You said:", "Dijiste:")}「{open.quote}」</p>}
        {open.source === "partner_shared" && <p className="profile-quote">{t(`${partner} 分享给你的。只有 TA 能收回。`, `${partner} shared this with you. Only they can take it back.`, `${partner} te lo compartió. Solo esa persona puede retirarlo.`)}</p>}
        {editing !== null ? <form onSubmit={(event) => { event.preventDefault(); void save(open); }} className="profile-edit">
          <KeyboardInput autoFocus value={editing} maxLength={160} onChange={(event) => setEditing(event.target.value)} onBlur={() => keyboard.hide()} aria-label={t("改成", "Change to", "Cambiar a")} />
          {open.sharedAt && <p className="profile-quote">{t("修改只保存在「只有我」，已分享的副本不会更新。", "Edits stay in Just me. The shared copy won't change.", "Los cambios quedan en Solo yo. La copia compartida no cambia.")}</p>}
          {/* Keep focus until click: blurring the field first moves the sheet with the keyboard. */}
          <button type="submit" onMouseDown={(event) => event.preventDefault()} disabled={busy || !editing.trim()}>{t("保存", "Save", "Guardar")}</button>
          <button type="button" className="danger" onMouseDown={(event) => event.preventDefault()} disabled={busy} onClick={() => void remove(open)} data-testid="profile-remove">{open.sharedAt ? t("删掉，并收回分享的副本", "Remove and withdraw the shared copy", "Borrar y retirar la copia compartida") : t("删掉这条私人记录", "Remove this private note", "Borrar esta nota privada")}</button>
        </form> : sharing ? <div className="profile-share">
          <p>{t(`${partner} 会看到这一句：`, `${partner} will see exactly this:`, `${partner} verá exactamente esto:`)}</p><blockquote>{sharing.text}</blockquote>
          <button type="button" disabled={busy} onClick={() => void share(open)} data-testid="profile-share-confirm">{t(`分享给 ${partner}`, `Share with ${partner}`, `Compartir con ${partner}`)}</button>
        </div> : <div className="profile-actions">
          {open.source === "mine" && <button type="button" onClick={() => setEditing(open.text)}><PencilSimple size={18} />{t("修改或删除", "Edit or remove", "Editar o borrar")}</button>}
          {open.source === "mine" && open.subject === "me" && partnerName && !open.sharedAt && <button type="button" className="profile-primary" disabled={busy} onClick={() => void prepareShare(open)} data-testid="profile-share"><ShareFat size={18} />{t("预览分享", "Preview share", "Vista previa")}</button>}
          {(open.source === "together" || open.source === "i_shared") && <button type="button" className="danger" disabled={busy} onClick={() => void remove(open)} data-testid="profile-remove"><Trash size={18} />{open.source === "together" ? t("删掉（两个人都看不到了）", "Remove (for both of you)", "Quitar (para los dos)") : t("收回分享，保留私人记录", "Withdraw share, keep private note", "Retirar copia, conservar nota privada")}</button>}
        </div>}
        {notice && <p className="settings-error" role="alert">{notice}</p>}
      </div>}
    </BottomSheet>
  </div>;
}
