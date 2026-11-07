import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChatCircleDots, ChatsCircle, Copy, FileArrowUp, Laptop, LockKey, Trash, UsersThree, Warning } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { PageHeader } from "../conversation/ConversationHome";
import { jsonBody, relationshipApi } from "../relationship/api";
import { ImportCard } from "./ImportCard";
import { importAction, listImports, uploadChatFile, type ChatImport } from "./imports";
import "./imports.css";

/** Chat histories the member brought in, and each one's analysis. Private unless both partners agreed to look together. */
export function ImportsPage({ id, user, paired, language, onBack, onOpen, onAsk }: { id: string; user: { id: string; name: string }; paired: boolean; language: Language; onBack: () => void; onOpen: (url: string) => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [imports, setImports] = useState<ChatImport[] | null>(null);
  // Moving between the list and one analysis stays inside this page; anything else goes back to the app.
  const [selected, setSelected] = useState(id);
  const go = (url: string) => { if (!url.startsWith("/?view=import")) { onOpen(url); return; } window.history.replaceState(null, "", url); setSelected(new URLSearchParams(url.slice(1)).get("import") || ""); void load(); };
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setImports(await listImports()); } catch (caught) { setError((caught as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const current = imports?.find((item) => item.id === selected) || null;
  if (selected && current?.status === "ready" && current.analysis) return <ImportReport item={current} user={user} paired={paired} language={language} onBack={() => go("/?view=import")} onAsk={onAsk} onChanged={load} />;
  return <div className="paper-screen relationship-shell import-screen" data-testid="imports-screen">
    <PageHeader language={language} title={t("聊天记录", "Chat history", "Historial de chat")} onBack={onBack} />
    <main className="relationship-main import-main">
      <p className="space-scope"><LockKey size={16} />{t("导入的聊天只有你能看到；想和 TA 一起看，要 TA 同意。", "Imported chats are visible only to you; looking together needs your partner's OK.", "Los chats importados solo los ves tú; verlos juntos necesita el sí de tu pareja.")}</p>
      {error && <p className="space-error" role="alert">{error}</p>}
      {selected && current && current.status !== "ready" && !current.sync && <ImportCard id={current.id} language={language} onOpen={go} onFinished={load} />}
      {!!imports?.length && <section className="import-list">{imports.map((item) => <button key={item.id} onClick={() => go(`/?view=import&import=${encodeURIComponent(item.id)}`)}>
        <span className="import-icon">{item.shared ? <UsersThree size={20} /> : <ChatsCircle size={20} />}</span>
        <span><strong>{item.title || t("聊天记录", "Chat history", "Historial de chat")}</strong><small>{item.sync ? (item.sync.lastSyncAt ? t(`每小时自动同步 · ${item.messageCount} 条 · 上次 ${new Date(item.sync.lastSyncAt).toLocaleString(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, `Syncs every hour · ${item.messageCount} · last ${new Date(item.sync.lastSyncAt).toLocaleString(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, `Se sincroniza cada hora · ${item.messageCount} · última ${new Date(item.sync.lastSyncAt).toLocaleString(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`) : t("等 Mac 第一次同步", "Waiting for the Mac's first sync", "Esperando la primera sincronización del Mac")) : item.status === "ready" ? `${item.messageCount} · ${item.firstAt?.slice(0, 10) || ""} – ${item.lastAt?.slice(0, 10) || ""}` : item.status === "analyzing" ? t("正在读…", "Reading…", "Leyendo…") : item.status === "failed" ? t("没读完", "Not finished", "Sin terminar") : t("等你确认", "Waiting for you", "Esperando tu respuesta")}</small></span><ArrowRight size={16} /></button>)}</section>}
      <ImportStart language={language} onImported={(item) => go(`/?view=import&import=${encodeURIComponent(item.id)}`)} onAsk={onAsk} />
    </main>
  </div>;
}

/** Ways in: a file, the Mac helper for iMessage, or asking Pinky for steps for any app. */
function ImportStart({ language, onImported, onAsk }: { language: Language; onImported: (item: ChatImport) => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [command, setCommand] = useState(""), [copied, setCopied] = useState(false);
  const pick = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ""; if (!file) return;
    setBusy(true); setError("");
    try { onImported(await uploadChatFile(file, { name: file.name, language })); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const mac = async () => { setError(""); try { setCommand((await relationshipApi<{ command: string }>("/api/imports/mac-sync-command", jsonBody({ language }))).command); } catch (caught) { setError((caught as Error).message); } };
  const copy = async () => { try { await navigator.clipboard.writeText(command); setCopied(true); } catch { setCopied(false); } };
  return <section className="import-start">
    <h2 className="space-subhead">{t("导入新的聊天", "Import a chat", "Importar un chat")}</h2>
    <button className="import-way" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="import-file"><FileArrowUp size={22} /><span><strong>{busy ? t("正在上传…", "Uploading…", "Subiendo…") : t("选择导出的文件", "Choose an exported file", "Elegir un archivo exportado")}</strong><small>WhatsApp · Messenger · Instagram · Telegram · LINE · iMazing · SMS Backup</small></span></button>
    <input ref={fileRef} type="file" accept=".txt,.zip,.json,.csv,.xml,.html,text/plain,application/zip,application/json" hidden onChange={(event) => void pick(event.target.files?.[0])} data-testid="import-file-input" />
    <button className="import-way" onClick={() => void mac()} data-testid="import-mac"><Laptop size={22} /><span><strong>{t("在 Mac 上自动同步 iMessage", "Sync iMessage from a Mac automatically", "Sincronizar iMessage desde un Mac")}</strong><small>{t("在登录同一 Apple ID 的 Mac 上运行一次，之后每小时自己同步", "Run it once on a Mac with the same Apple ID; it then syncs every hour", "Ejecútalo una vez en un Mac con el mismo Apple ID; luego se sincroniza cada hora")}</small></span></button>
    {command && <div className="import-command">
      <ol><li>{t("在 Mac 上打开“终端”（启动台 → 其他 → 终端）。", "On the Mac, open Terminal (Launchpad → Other → Terminal).", "En el Mac, abre Terminal (Launchpad → Otros → Terminal).")}</li>
        <li>{t("粘贴下面这条命令，按回车。", "Paste this command and press Return.", "Pega este comando y pulsa Intro.")}</li>
        <li>{t("第一次会提示给“终端”完全磁盘访问权限，按提示打开后再运行一次。", "The first time, it asks you to give Terminal Full Disk Access; turn it on and run it again.", "La primera vez te pedirá dar a Terminal acceso total al disco; actívalo y ejecútalo otra vez.")}</li>
        <li>{t("选出和 TA 的对话编号。之后每小时自动同步，只有你能看到；Mac 合上时暂停，打开后补上。", "Pick the conversation with your partner. From then on it syncs every hour, visible only to you; it pauses while the Mac sleeps and catches up after.", "Elige la conversación con tu pareja. Desde entonces se sincroniza cada hora, solo para ti; se pausa con el Mac dormido y luego se pone al día.")}</li>
        <li>{t("最后按终端里的提示，把 /bin/zsh 也加进“完全磁盘访问权限”（只做一次），后台同步才能读到。", "Last, as Terminal says, add /bin/zsh to Full Disk Access too (once), so the background sync can read.", "Por último, como indica Terminal, añade /bin/zsh al acceso total al disco (una vez) para que la sincronización en segundo plano pueda leer.")}</li></ol>
      <code>{command}</code><button onClick={() => void copy()}><Copy size={16} />{copied ? t("已复制", "Copied", "Copiado") : t("复制命令", "Copy command", "Copiar comando")}</button>
    </div>}
    <button className="import-way" onClick={() => onAsk(t("我想导入我和 TA 的聊天记录，告诉我怎么从", "I want to import my chat history with my partner. How do I export it from ", "Quiero importar mi historial de chat con mi pareja. ¿Cómo lo exporto desde "), "me")}><ChatCircleDots size={22} /><span><strong>{t("问 Pinky 怎么导出", "Ask Pinky how to export", "Pregúntale a Pinky cómo exportar")}</strong><small>{t("微信、iPhone 短信等：Pinky 一步步教你，也可以直接发截图", "WeChat, iPhone texts and more: Pinky walks you through it, or send screenshots", "WeChat, mensajes del iPhone y más: Pinky te guía, o envía capturas")}</small></span></button>
    {error && <p className="space-error" role="alert">{error}</p>}
  </section>;
}

function ImportReport({ item, user, paired, language, onBack, onAsk, onChanged }: { item: ChatImport; user: { id: string; name: string }; paired: boolean; language: Language; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void; onChanged: () => void | Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [confirming, setConfirming] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [requested, setRequested] = useState(Boolean(item.shareRequestedAt));
  const analysis = item.analysis!, stats = item.stats;
  const names = { me: item.people.find((person) => person.role === "me")?.name || "", partner: item.people.find((person) => person.role === "partner")?.name || "" };
  const owner = item.ownerUserId === user.id;
  const date = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "";
  const run = async (key: string, action: () => Promise<unknown>, after?: () => void) => {
    if (["delete", "delete-messages", "unshare"].includes(key) && confirming !== key) { setConfirming(key); return; }
    setConfirming(""); setBusy(true); setError("");
    try { await action(); after?.(); await onChanged(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const peak = Math.max(1, ...(stats?.monthly || []).map((month) => month.me + month.partner));
  const per = stats?.perPerson;
  return <div className="paper-screen relationship-shell import-screen" data-testid="import-report">
    <PageHeader language={language} title={t("聊天记录分析", "Chat analysis", "Análisis del chat")} onBack={onBack} />
    <main className="relationship-main import-main">
      <p className="space-scope">{item.shared ? <><UsersThree size={16} />{t("你们俩都同意了，都能看到", "You both agreed; both of you can see this", "Los dos aceptaron; ambos pueden verlo")}</> : <><LockKey size={16} />{t("只有你能看到", "Only you can see this", "Solo tú puedes verlo")}</>}</p>
      <p className="import-meta">{item.title && <>{t(`和 ${item.title}`, `With ${item.title}`, `Con ${item.title}`)} · </>}{t(`${item.messageCount} 条消息`, `${item.messageCount} messages`, `${item.messageCount} mensajes`)} · {date(item.firstAt)} – {date(item.lastAt)}{item.sampled ? t("（太长，读了最重要的部分）", " (very long; the most important parts were read)", " (muy largo; se leyeron las partes más importantes)") : ""}</p>
      {analysis.safety.concern && <div className="import-safety" role="note"><Warning size={20} weight="fill" /><p>{analysis.safety.note}</p></div>}
      <p className="import-overview">{analysis.overview}</p>
      {analysis.conflictCycle && <section className="import-block"><h2 className="space-subhead">{t("吵架时常见的循环", "The cycle in your arguments", "El ciclo en sus discusiones")}</h2><p>{analysis.conflictCycle}</p></section>}
      {!!analysis.patterns.length && <section className="import-block"><h2 className="space-subhead">{t("规律", "Patterns", "Patrones")}</h2>{analysis.patterns.map((pattern) => <article key={pattern.title} className="import-pattern"><strong>{pattern.title}</strong><p>{pattern.detail}</p>{pattern.evidence.map((quote, index) => <blockquote key={index}>“{quote.quote}”<small>{[quote.speaker, date(quote.date)].filter(Boolean).join(" · ")}</small></blockquote>)}</article>)}</section>}
      {!!analysis.strengths.length && <section className="import-block"><h2 className="space-subhead">{t("你们已经做得好的", "What already works", "Lo que ya funciona")}</h2><ul>{analysis.strengths.map((entry) => <li key={entry.title}><strong>{entry.title}</strong><p>{entry.detail}</p></li>)}</ul></section>}
      {!!analysis.hurts.length && <section className="import-block"><h2 className="space-subhead">{t("各自在意的", "What each of you needs", "Lo que cada uno necesita")}</h2><ul>{analysis.hurts.map((entry, index) => <li key={index}><strong>{entry.speaker}</strong><p>{entry.detail}</p></li>)}</ul></section>}
      {!!analysis.suggestions.length && <section className="import-block"><h2 className="space-subhead">{t("可以试试", "Things to try", "Cosas para probar")}</h2><ul>{analysis.suggestions.map((entry) => <li key={entry.title}><strong>{entry.title}</strong><p>{entry.detail}</p></li>)}</ul></section>}
      {per && <section className="import-block"><h2 className="space-subhead">{t("数字", "Numbers", "Cifras")}</h2>
        <table className="import-stats"><thead><tr><th /><th>{names.me}</th><th>{names.partner}</th></tr></thead><tbody>
          <tr><th>{t("消息", "Messages", "Mensajes")}</th><td>{per.me.messages}</td><td>{per.partner.messages}</td></tr>
          <tr><th>{t("先开口的次数", "Started a conversation", "Iniciaron la conversación")}</th><td>{per.me.initiations}</td><td>{per.partner.initiations}</td></tr>
          <tr><th>{t("回复时间（中位）", "Reply time (median)", "Tiempo de respuesta (mediana)")}</th><td>{per.me.replyMinutesMedian ?? "–"} {t("分钟", "min", "min")}</td><td>{per.partner.replyMinutesMedian ?? "–"} {t("分钟", "min", "min")}</td></tr>
          <tr><th>{t("深夜消息", "Late-night messages", "Mensajes de madrugada")}</th><td>{per.me.lateNight}%</td><td>{per.partner.lateNight}%</td></tr>
        </tbody></table>
        {stats!.monthly.length > 1 && <div className="import-months" aria-label={t("每月消息数", "Messages per month", "Mensajes por mes")}>{stats!.monthly.slice(-24).map((month) => <span key={month.month} title={`${month.month}: ${month.me + month.partner}`} style={{ height: `${Math.max(3, (month.me + month.partner) / peak * 100)}%` }} />)}</div>}
        {!!stats!.silences.length && <p className="import-note">{t("最长的安静期：", "Longest quiet stretches: ", "Silencios más largos: ")}{stats!.silences.slice(0, 3).map((gap) => t(`${date(gap.from)} 起 ${gap.days} 天`, `${gap.days} days from ${date(gap.from)}`, `${gap.days} días desde ${date(gap.from)}`)).join("，")}</p>}
      </section>}
      {!!analysis.moments.length && <section className="import-block"><h2 className="space-subhead">{t("值得留下的瞬间", "Moments worth keeping", "Momentos para guardar")}</h2><ul>{analysis.moments.map((moment, index) => <li key={index}><strong>{moment.title}</strong>{moment.date && <small>{date(moment.date)}</small>}<p>{moment.text}</p></li>)}</ul>
        <button className="space-ask" onClick={() => onAsk(t("把聊天记录分析里那些值得留下的瞬间放进我们的回忆", "Save the moments worth keeping from the chat analysis into our memories", "Guarda en nuestros recuerdos los momentos del análisis del chat"), item.shared ? "us" : "me")}><ChatCircleDots size={20} weight="fill" />{t("放进回忆", "Save to memories", "Guardar en recuerdos")}</button></section>}
      {!!analysis.watched?.length && <section className="import-block"><h2 className="space-subhead">{t("一起看过的剧和电影", "Shows you watched together", "Lo que vieron juntos")}</h2><ul>{analysis.watched.map((show, index) => <li key={index}><strong>{show.title}</strong>{show.date && <small>{date(show.date)}</small>}{show.note && <p>{show.note}</p>}</li>)}</ul>
        <button className="space-ask" onClick={() => onAsk(t("把聊天记录分析里我们一起看过的剧和电影放进“一起看过的”", "Put the shows from the chat analysis on our watched-together shelf", "Pon en nuestro estante lo que vimos juntos según el análisis del chat"), item.shared ? "us" : "me")}><ChatCircleDots size={20} weight="fill" />{t("放进一起看过的", "Add to watched together", "Añadir a vistos juntos")}</button></section>}
      {!!analysis.dates.length && <section className="import-block"><h2 className="space-subhead">{t("重要的日子", "Dates to remember", "Fechas para recordar")}</h2><ul>{analysis.dates.map((entry, index) => <li key={index}><strong>{entry.title}</strong><small>{date(entry.date)}{entry.yearly ? t(" · 每年", " · yearly", " · cada año") : ""}</small></li>)}</ul></section>}
      {!!analysis.promises.length && <section className="import-block"><h2 className="space-subhead">{t("说过的承诺", "Promises made", "Promesas hechas")}</h2><ul>{analysis.promises.map((promise, index) => <li key={index} className={`is-${promise.status}`}><strong>{promise.speaker}：{promise.text}</strong><small>{[date(promise.date), promise.status === "kept" ? t("做到了", "kept", "cumplida") : promise.status === "open" ? t("还没做到", "still open", "pendiente") : t("不确定", "unclear", "no está claro")].filter(Boolean).join(" · ")}</small></li>)}</ul></section>}
      <button className="space-ask" onClick={() => onAsk(t(`关于我们的聊天记录分析，我想问：`, "About our chat history analysis: ", "Sobre el análisis de nuestro historial: "), item.shared ? "us" : "me")}><ChatCircleDots size={20} weight="fill" />{t("问 Pinky", "Ask Pinky", "Pregúntale a Pinky")}</button>
      <section className="import-block import-controls">
        {owner && !item.shared && paired && !item.sharedCopyId && <button disabled={busy || requested} onClick={() => void run("share", () => importAction(item.id, "share-request", { language }), () => setRequested(true))}><UsersThree size={18} />{requested ? t("已邀请 TA，等 TA 同意", "Asked your partner; waiting for their OK", "Le preguntaste a tu pareja; esperando su respuesta") : t("邀请 TA 一起看", "Ask your partner to look together", "Pedirle a tu pareja verlo juntos")}</button>}
        {owner && !item.shared && item.sharedCopyId && <p className="import-note"><UsersThree size={16} />{t("TA 已同意，“我们俩”里有一份共享的分析。", "Your partner agreed; a shared copy is in Us.", "Tu pareja aceptó; hay una copia compartida en Nosotros.")}</p>}
        {item.shared && <button className={confirming === "unshare" ? "confirming" : ""} disabled={busy} onClick={() => void run("unshare", () => importAction(item.id, "unshare"), onBack)}>{confirming === "unshare" ? t("确认从“我们俩”移除", "Confirm removing it from Us", "Confirmar quitarlo de Nosotros") : t("从“我们俩”移除", "Remove from Us", "Quitar de Nosotros")}</button>}
        {owner && !item.shared && !item.rawDeleted && <button className={confirming === "delete-messages" ? "confirming" : ""} disabled={busy} onClick={() => void run("delete-messages", () => importAction(item.id, "delete-messages"))}><Trash size={18} />{confirming === "delete-messages" ? t("确认删除原文（保留分析）", "Confirm deleting the messages (keep the analysis)", "Confirmar borrar los mensajes (guardar el análisis)") : t("只删除原始消息", "Delete the messages only", "Borrar solo los mensajes")}</button>}
        {owner && !item.shared && <button className={confirming === "delete" ? "confirming" : ""} disabled={busy} onClick={() => void run("delete", () => relationshipApi(`/api/imports/${encodeURIComponent(item.id)}`, { method: "DELETE" }), onBack)}><Trash size={18} />{confirming === "delete" ? t("确认全部删除", "Confirm deleting everything", "Confirmar borrar todo") : t("全部删除", "Delete everything", "Borrar todo")}</button>}
        {item.rawDeleted && <p className="import-note">{t("原始消息已删除，只保留了分析。", "The messages were deleted; only the analysis is kept.", "Los mensajes se borraron; solo queda el análisis.")}</p>}
        {error && <p className="space-error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;
}
