import { useEffect, useState } from "react";
import { ChatCircleDots, Trash } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { useKeyboard } from "../../mobile";
import { BottomSheet } from "../navigation/Sheet";
import { PageHeader } from "../conversation/ConversationHome";
import { jsonBody, relationshipApi } from "../relationship/api";
import { Avatar, plainName, type PeopleState, type Person } from "./People";
import "./people-page.css";

export function PeoplePage({ language, initialPerson, archived = false, onBack, backLabel, onAsk, onChat }: { language: Language; initialPerson: string; archived?: boolean; onBack: () => void; backLabel?: string; onAsk: (text: string, channel: "me" | "us") => void; onChat: (personId: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [personId, setPersonId] = useState(initialPerson);
  const [directory, setDirectory] = useState<PeopleState | null>(null);
  const [detail, setDetail] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const keyboard = useKeyboard();
  useEffect(() => {
    let alive = true;
    setError(""); setDetail(null);
    const load = async () => {
      const board = await relationshipApi<PeopleState>(archived ? "/api/people?archived=1" : "/api/people/board");
      if (!alive) return;
      setDirectory(board);
      if (personId) {
        const result = await relationshipApi<{ person: Person }>(`/api/people/${encodeURIComponent(personId)}`);
        if (alive) setDetail(result.person);
      }
    };
    void load().catch((reason: Error) => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [personId, archived, refresh]);

  const closeDetail = () => { setDeleting(false); setPersonId(""); };
  const settle = async (id: string | null) => {
    setBusy(true); setError("");
    try {
      await relationshipApi(id ? `/api/people/${encodeURIComponent(id)}/choose` : "/api/people/unchoose", jsonBody(id ? { chosen: true } : {}));
      closeDetail(); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!detail || busy) return;
    setBusy(true); setError("");
    try {
      await relationshipApi(`/api/people/${encodeURIComponent(detail.id)}`, { method: "DELETE", body: JSON.stringify({ confirm: detail.id }) });
      setDirectory(null); closeDetail(); setRefresh((value) => value + 1);
    } catch (reason) { setDeleting(false); setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const people = directory?.people.filter((person) => !archived || person.archived) || [];
  const title = archived ? t("以前的档案", "Earlier people", "Personas anteriores") : t("在了解的人", "People I'm seeing", "Personas que conozco");
  return <div className="paper-screen relationship-shell people-screen" data-testid={personId ? "person-page" : archived ? "people-earlier" : "people-page"}>
    <PageHeader language={language} title={personId && detail ? detail.name : title} onBack={personId ? closeDetail : onBack} backLabel={personId ? title : backLabel} />
    <main className="relationship-main people-main">
      {error && <div role="alert" className="people-error">{error} <button type="button" className="people-secondary" onClick={() => setRefresh((value) => value + 1)}>{t("重试", "Retry", "Reintentar")}</button></div>}
      {(personId ? !detail : !directory) && !error && <p className="people-muted">{t("正在打开…", "Opening…", "Abriendo…")}</p>}
      {personId && detail && <>
        <div className="person-top"><Avatar name={detail.name} /><span><h1>{detail.name}</h1><small>{t("私人联系人", "Private contact", "Contacto privado")}</small></span></div>
        {!archived && <button type="button" className="people-primary" onClick={() => onChat(detail.id)} data-testid="person-talk"><ChatCircleDots size={20} />{t("打开私人对话", "Open private conversation", "Abrir conversación privada")}</button>}
        {!archived && directory?.stage === "dating" && <button type="button" disabled={busy} className="people-secondary" onClick={() => void settle(detail.id)}>{t("我们确定关系了", "We're together now", "Ya somos pareja")}</button>}
        <button type="button" className="people-secondary" onClick={() => { keyboard.hide(); setDeleting(true); }} data-testid="person-delete"><Trash size={18} />{t("删除这份档案", "Delete this file", "Eliminar esta ficha")}</button>
      </>}
      {!personId && directory && <>
        {directory.stage === "chosen" && directory.chosen && !archived && <section className="people-card people-read" data-testid="people-chosen"><h2>{t(`你已经确定了${plainName(directory.chosen.name)}`, `You're together with ${directory.chosen.name}`, `Estás con ${directory.chosen.name}`)}</h2>
          <div className="people-actions"><button type="button" className="people-primary" onClick={() => onAsk("", "us")} data-testid="people-invite">{t("邀请 TA 一起用 Ourever", "Invite them to Ourever", "Invitar a Ourever")}</button><button type="button" className="people-secondary" disabled={busy} onClick={() => void settle(null)} data-testid="people-unchoose">{t("其实还没确定", "Not settled after all", "Aún no")}</button></div></section>}
        {people.length ? people.map((person) => <button key={person.id} type="button" className="people-person-card" data-testid={archived ? "people-earlier-row" : "people-person"} onClick={() => setPersonId(person.id)}><span className="person-card-head"><Avatar name={person.name} /><span><strong>{person.name}</strong><small>{new Date(person.lastSeenAt).toLocaleDateString(languageTag(language))}</small></span></span></button>)
          : <><p className="people-muted">{archived ? t("没有收起来的档案。", "No archived contacts.", "No hay contactos archivados.") : t("你在私人对话里提到正在了解的人后，可以在这里找到对方的档案。", "Talk about someone you’re getting to know in your private chat to start their page here.", "Habla en tu chat privado de alguien a quien estás conociendo para crear aquí su ficha.")}</p>
            {!archived && <button type="button" className="people-primary" onClick={() => onAsk(t("我最近在了解一个人，名字是", "I’m getting to know someone named ", "Estoy conociendo a alguien que se llama "), "me")}>{t("聊聊这个人", "Talk about someone", "Hablar de alguien")}</button>}</>}
      </>}
    </main>
    <BottomSheet open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open); }} title={t(`删除${detail?.name || ""}的档案？`, `Delete the file for ${detail?.name || ""}?`, `¿Eliminar la ficha de ${detail?.name || ""}?`)}
      description={t("联系人、对应档案笔记和与 Ourever 单独聊这个人的对话将永久删除。原始导入和已分享的副本单独保留，可在「聊天记录」中管理。其他对话中提到此人的文字也会保留。", "This permanently deletes this contact, their file notes and the dedicated private conversation about them. Original imports and shared copies are managed separately in Chat history. Mentions in other conversations are kept.", "Se eliminarán el contacto, sus notas y la conversación privada dedicada a esa persona. Las importaciones y copias compartidas se gestionan por separado en Historial de chat. Se conservan las menciones en otras conversaciones.")}>
      <div className="person-sheet person-actions"><button type="button" className="person-secondary" disabled={busy} onClick={() => setDeleting(false)}>{t("取消", "Cancel", "Cancelar")}</button><button type="button" className="person-primary" disabled={busy} onClick={() => void remove()} data-testid="person-delete-confirm">{t("永久删除", "Delete permanently", "Eliminar definitivamente")}</button></div>
    </BottomSheet>
  </div>;
}
