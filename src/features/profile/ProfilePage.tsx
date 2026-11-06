import { useCallback, useEffect, useState } from "react";
import { ChatCircleDots, PencilSimple, ShareFat, Trash } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./profile.css";

type Category = "food" | "likes" | "dislikes" | "wishes" | "traits" | "people" | "other";
type Fact = { id: string; version: number; text: string; category: Category; subject: "me" | "partner" | "us"; source: "mine" | "together" | "i_shared" | "partner_shared"; quote: string | null; sharedAt: string | null; updatedAt: string };
const CATEGORIES: Category[] = ["food", "likes", "dislikes", "wishes", "traits", "people", "other"];

/** 关于我们 (喜好档案, founder 11-06): what Pinky keeps about each of them, kept by itself from their conversations. Each
 * person's notes are their own; a line about yourself can be shared, and what was said together in Us belongs to both. */
export function ProfilePage({ language, onAsk }: { language: Language; onAsk?: (text: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [tab, setTab] = useState<"me" | "partner" | "us">("partner");
  const [open, setOpen] = useState<Fact | null>(null);
  const [editing, setEditing] = useState(""); const [sharing, setSharing] = useState<{ text: string; digest: string } | null>(null);
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
  const tabs: Array<["me" | "partner" | "us", string]> = partnerName ? [["partner", partner], ["me", t("我", "Me", "Yo")], ["us", t("我们", "Us", "Nosotros")]] : [["me", t("我", "Me", "Yo")]];
  const shown = tabs.some(([value]) => value === tab) ? tab : tabs[0][0];
  const label: Record<Category, string> = { food: t("吃喝", "Food and drink", "Comida y bebida"), likes: t("喜欢", "Loves", "Le encanta"), dislikes: t("不喜欢 · 雷区", "Dislikes · sore spots", "No le gusta · puntos sensibles"), wishes: t("想要的", "Wishes", "Deseos"), traits: t("性格和习惯", "Traits and habits", "Forma de ser y hábitos"), people: t("重要的人和日子", "People and days that matter", "Personas y fechas importantes"), other: t("其他", "Other", "Otros") };
  const tag = (fact: Fact) => fact.source === "together" ? t("一起说过", "Said together", "Lo dijeron juntos") : fact.source === "partner_shared" ? t(`${partner} 分享的`, `Shared by ${partner}`, `Compartido por ${partner}`) : fact.source === "i_shared" || fact.sharedAt ? t(`已分享给 ${partner}`, `Shared with ${partner}`, `Compartido con ${partner}`) : "";
  const list = (facts || []).filter((fact) => fact.subject === shown && !(fact.source === "i_shared" && (facts || []).some((other) => other.source === "mine" && other.sharedAt && other.text === fact.text)));
  const close = () => { keyboard.hide(); setOpen(null); setEditing(""); setSharing(null); };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setNotice(""); keyboard.hide();
    try { await action(); close(); await load(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const save = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}`, { method: "PATCH", body: JSON.stringify({ text: editing, expectedVersion: fact.version, language }) }));
  const remove = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: fact.version, language }) }));
  const share = (fact: Fact) => run(() => relationshipApi(`/api/profile/${fact.id}/share`, jsonBody({ confirm: true, digest: sharing?.digest, expectedVersion: fact.version, language })));
  const prepareShare = async (fact: Fact) => { setNotice(""); try { setSharing(await relationshipApi<{ text: string; digest: string }>(`/api/profile/${fact.id}/share-preview?language=${language}`)); } catch (error) { setNotice((error as Error).message); } };
  const intro = shown === "partner" ? t(`你跟 Pinky 聊到 ${partner} 时，Pinky 会自己记下来，挑礼物、出主意时都会用上。这些只有你能看到。`, `When you talk about ${partner}, Pinky keeps what matters and uses it for ideas and gifts. Only you see these.`, `Cuando hablas de ${partner}, Pinky guarda lo importante y lo usa para ideas y regalos. Solo tú lo ves.`)
    : shown === "me" ? t(`Pinky 从聊天里了解到的你。只有你能看到；想让 ${partner} 知道的，可以点开分享。`, `What Pinky has learned about you. Only you see these; open one to share it with ${partner}.`, `Lo que Pinky sabe de ti. Solo tú lo ves; abre uno para compartirlo con ${partner}.`)
    : t("你们俩一起的习惯和默契。", "How the two of you work together.", "Cómo funcionan ustedes dos juntos.");
  const ask = shown === "partner" ? t(`跟你说说 ${partner}：`, `Let me tell you about ${partner}: `, `Te cuento sobre ${partner}: `) : shown === "me" ? t("跟你说说我自己：", "Let me tell you about me: ", "Te cuento sobre mí: ") : t("我们俩：", "About the two of us: ", "Sobre nosotros dos: ");

  return <div className="profile-page" data-testid="profile-page">
    {tabs.length > 1 && <div className="profile-tabs" role="tablist" aria-label={t("关于谁", "About whom", "Sobre quién")}>{tabs.map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={shown === value} className={shown === value ? "active" : ""} onClick={() => setTab(value)} data-testid={`profile-tab-${value}`}>{name}</button>)}</div>}
    <p className="settings-intro">{intro}</p>
    {facts === null ? <p className="profile-empty" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>
      : !list.length ? <div className="profile-empty"><strong>{t("还没有记下什么", "Nothing yet", "Aún no hay nada")}</strong><p>{t("平时和 Pinky 聊天时提到的喜好、雷区、想要的东西，会自动出现在这里。", "Likes, sore spots and wishes you mention while chatting with Pinky appear here by themselves.", "Los gustos, puntos sensibles y deseos que mencionas al hablar con Pinky aparecen aquí solos.")}</p></div>
      : CATEGORIES.filter((category) => list.some((fact) => fact.category === category)).map((category) => <section key={category} className="settings-group">
        <h2>{label[category]}</h2>
        <div className="settings-card">{list.filter((fact) => fact.category === category).map((fact) => <button key={fact.id} type="button" className="settings-row profile-fact" onClick={() => { setNotice(""); setOpen(fact); setEditing(""); setSharing(null); }} data-testid="profile-fact">
          <span className="profile-fact-text">{fact.text}</span>{tag(fact) && <em>{tag(fact)}</em>}
        </button>)}</div>
      </section>)}
    {onAsk && <button type="button" className="profile-ask" onClick={() => onAsk(ask)}><ChatCircleDots size={20} weight="fill" />{shown === "partner" ? t(`跟 Pinky 说说 ${partner}`, `Tell Pinky about ${partner}`, `Cuéntale a Pinky sobre ${partner}`) : shown === "me" ? t("跟 Pinky 说说自己", "Tell Pinky about yourself", "Cuéntale a Pinky sobre ti") : t("跟 Pinky 说说你们俩", "Tell Pinky about you two", "Cuéntale a Pinky sobre ustedes")}</button>}
    {notice && !open && <p className="settings-error" role="alert">{notice}</p>}

    <BottomSheet open={Boolean(open)} onOpenChange={(value) => { if (!value) close(); }} title={open?.text || ""} description={open ? label[open.category] : undefined}>
      {open && <div className="profile-sheet">
        {open.quote && <p className="profile-quote">{open.source === "together" ? t("你们在「我们」里说过：", "Said together in Us:", "Lo dijeron en Nosotros:") : t("你说过：", "You said:", "Dijiste:")}「{open.quote}」</p>}
        {open.source === "partner_shared" && <p className="profile-quote">{t(`${partner} 分享给你的。只有 TA 能收回。`, `${partner} shared this with you. Only they can take it back.`, `${partner} te lo compartió. Solo esa persona puede retirarlo.`)}</p>}
        {editing ? <form onSubmit={(event) => { event.preventDefault(); void save(open); }} className="profile-edit">
          <KeyboardInput autoFocus value={editing} maxLength={160} onChange={(event) => setEditing(event.target.value)} onBlur={() => keyboard.hide()} aria-label={t("改成", "Change to", "Cambiar a")} />
          <button type="submit" disabled={busy || !editing.trim()}>{t("保存", "Save", "Guardar")}</button>
        </form> : sharing ? <div className="profile-share">
          <p>{t(`${partner} 会看到这一句：`, `${partner} will see exactly this:`, `${partner} verá exactamente esto:`)}</p><blockquote>{sharing.text}</blockquote>
          <button type="button" disabled={busy} onClick={() => void share(open)} data-testid="profile-share-confirm">{t(`分享给 ${partner}`, `Share with ${partner}`, `Compartir con ${partner}`)}</button>
        </div> : <div className="profile-actions">
          {open.source === "mine" && <button type="button" onClick={() => setEditing(open.text)}><PencilSimple size={18} />{t("改一下", "Edit", "Editar")}</button>}
          {open.source === "mine" && open.subject === "me" && partnerName && !open.sharedAt && <button type="button" onClick={() => void prepareShare(open)} data-testid="profile-share"><ShareFat size={18} />{t(`分享给 ${partner}`, `Share with ${partner}`, `Compartir con ${partner}`)}</button>}
          {open.source !== "partner_shared" && <button type="button" className="danger" disabled={busy} onClick={() => void remove(open)} data-testid="profile-remove"><Trash size={18} />{open.source === "together" ? t("删掉（两个人都看不到了）", "Remove (for both of you)", "Quitar (para los dos)") : open.sharedAt ? t(`删掉，并从 ${partner} 那边收回`, `Remove, and take it back from ${partner}`, `Quitar y retirarlo de ${partner}`) : t("删掉", "Remove", "Quitar")}</button>}
        </div>}
        {notice && <p className="settings-error" role="alert">{notice}</p>}
      </div>}
    </BottomSheet>
  </div>;
}
