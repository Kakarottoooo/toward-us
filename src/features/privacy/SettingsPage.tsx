import { useEffect, useState, type ReactNode } from "react";
import { Bell, Brain, CaretRight, Crown, Check, ClockCounterClockwise, DownloadSimple, Eye, Heart, Key, LinkBreak, ListChecks, ShieldCheck, SignOut, Sticker, Translate, Trash, UserMinus, UsersThree } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { BottomSheet, KeyboardInput, useKeyboard } from "../../mobile";
import { PageHeader, readUsHidden, usHiddenKey } from "../conversation/ConversationHome";
import { MemoryWorkspace } from "../memories/MemoryWorkspace";
import { ProfilePage } from "../profile/ProfilePage";
import { NotificationSettings } from "./NotificationSettings";
import { jsonBody, relationshipApi } from "../relationship/api";
import { CharacterMaker } from "../character/CharacterMaker";
import { characterError, setCharacterVisible, useCoupleCharacter } from "../character/character";
import { MembershipPage, type Membership } from "../membership/MembershipPage";
import "./settings.css";

type Summary = { id: string; relationshipId?: string; issueId: string; text: string; version: number; status: string; aiAccessScope: string; withdrawnAt: string | null };
type PrivacyData = { privateRetentionDays: number | null; recoveryEnabled: boolean; privateCount: number; relationships: Array<{ id: string; status: string }>; sharedSummaries: Summary[]; consentHistory: Array<{ eventType: string; createdAt: string; sourceVersion?: number }> };
type PendingAction = { kind: "retention" | "recovery" | "export" | "delete-private" | "leave" | "account"; days?: number | null } | { kind: "withdraw"; summary: Summary };
type Page = "main" | "membership" | "profile" | "notifications" | "processors" | "memory" | "retention" | "summaries" | "history" | "recovery" | "character";
type SettingsProps = { initialPage?: "character" | "profile" | "membership"; onAsk?: (text: string) => void; user: { id: string; name: string; email: string }; relationshipId: string | null; partnerName: string | null; language: Language; onLanguage: (language: Language) => void; onBack: () => void; onLogout: () => void; onLeft: () => void | Promise<void>; onDeleted: () => void | Promise<void> };
const LANGUAGES: Language[] = ["zh", "en", "es"];

function downloadFile(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One settings row in the grouped-list style of mature phone apps: icon, label, current value, and where it leads. */
function Row({ icon, tone = "blue", label, value, onClick, danger = false, testId, children }: { icon: ReactNode; tone?: "blue" | "green" | "gray" | "red" | "pink"; label: string; value?: string; onClick?: () => void; danger?: boolean; testId?: string; children?: ReactNode }) {
  const body = <><span className={`settings-icon tone-${tone}`}>{icon}</span><span className={`settings-label ${danger ? "danger" : ""}`}>{label}</span>{children}{value && <span className="settings-value">{value}</span>}{onClick && !children && <CaretRight size={16} weight="bold" className="settings-chevron" />}</>;
  return onClick ? <button type="button" className="settings-row" onClick={onClick} data-testid={testId}>{body}</button> : <div className="settings-row" data-testid={testId}>{body}</div>;
}
const Group = ({ title, note, children }: { title?: string; note?: string; children: ReactNode }) => <section className="settings-group">{title && <h2>{title}</h2>}<div className="settings-card">{children}</div>{note && <p className="settings-note">{note}</p>}</section>;

/** Settings: account, language, privacy and data, each one row deep; every irreversible step is confirmed in a sheet with the password. */
export function SettingsPage({ initialPage, onAsk, user, relationshipId, partnerName, language, onLanguage, onBack, onLogout, onLeft, onDeleted }: SettingsProps) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [page, setPage] = useState<Page>(initialPage || "main");
  // The couple's character: made by either of them, shown to both; showing it on this screen is each member's own choice.
  const { character, setCharacter } = useCoupleCharacter(Boolean(relationshipId));
  const [characterNotice, setCharacterNotice] = useState("");
  const [usShown, setUsShown] = useState(() => !readUsHidden(user.id));
  const toggleUs = () => { const next = !usShown; setUsShown(next); try { if (next) localStorage.removeItem(usHiddenKey(user.id)); else localStorage.setItem(usHiddenKey(user.id), "1"); } catch { /* the switch still applies for this visit */ } };
  const toggleCharacter = async () => {
    if (!character) return; setCharacterNotice("");
    try { setCharacter(await setCharacterVisible(!character.visible)); } catch (error) { setCharacterNotice(characterError((error as Error).message, language)); }
  };
  const characterValue = !relationshipId || !character ? "" : character.making && character.making.state !== "failed" ? t("制作中", "Making", "Creando") : !character.image ? "" : character.visible ? t("显示中", "Shown", "Visible") : t("已隐藏", "Hidden", "Oculto");
  const [data, setData] = useState<PrivacyData | null>(null);
  const [plan, setPlan] = useState<Membership["plan"] | null>(null);
  useEffect(() => { void relationshipApi<Membership>("/api/membership").then((value) => setPlan(value.plan)).catch(() => {}); }, [page]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [password, setPassword] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState(""); const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const load = async () => { try { setData(await relationshipApi<PrivacyData>(`/api/privacy?language=${language}`)); } catch (error) { setNotice((error as Error).message); } };
  useEffect(() => { void load(); }, [language]);
  const open = (next: Page) => { keyboard.hide(); setNotice(""); setPage(next); };
  const prepare = (action: PendingAction) => { keyboard.hide(); setPending(action); setPassword(""); setConfirmed(false); setNotice(""); };
  const close = () => { keyboard.hide(); setPending(null); setPassword(""); setConfirmed(false); };
  const period = (value: number | null) => value === null ? t("由我手动删除", "Until I delete them", "Hasta que los borre") : t(`${value} 天没更新就删除`, `After ${value} days without changes`, `Tras ${value} días sin cambios`);
  const actionTitle = (action: PendingAction) => ({ retention: t("更改保留期限", "Change how long private content stays", "Cambiar cuánto se conserva"), recovery: t("生成新恢复码", "Generate a new recovery code", "Generar un nuevo código"), export: t("下载我的数据", "Download my data", "Descargar mis datos"), "delete-private": t("删除我的私人内容", "Delete my private content", "Borrar mi contenido privado"), leave: t("退出当前关系", "Leave this relationship", "Salir de esta relación"), account: t("删除账号", "Delete account", "Borrar la cuenta"), withdraw: t("停止共同 AI 使用这段摘要", "Stop joint AI use of this summary", "Detener el uso de este resumen por la IA compartida") })[action.kind];
  const actionDescription = (action: PendingAction) => {
    if (action.kind === "retention") return t(`新规则：${period(action.days ?? null)}。只影响你的私人对话、私人记忆和日常记录，清理后无法恢复。共享内容、约定、提醒和同意记录不受影响。`, `New rule: ${period(action.days ?? null)}. It applies only to your private conversations, private memories and check-ins, and deleted items cannot be restored. Shared content, agreements, reminders and consent records are not affected.`, `Nueva regla: ${period(action.days ?? null)}. Solo afecta tus conversaciones privadas, recuerdos privados y registros diarios, y lo borrado no se recupera. Lo compartido, los acuerdos, recordatorios y registros de consentimiento no cambian.`);
    if (action.kind === "recovery") return t("新码会立刻让旧码失效。完整的码只显示这一次，请存到安全的地方。", "The new code replaces the old one immediately. The full code is shown only once; keep it somewhere safe.", "El nuevo código reemplaza al anterior de inmediato. Solo se muestra una vez; guárdalo en un lugar seguro.");
    if (action.kind === "export") return t("下载一份 JSON 文件，包含你自己的私人内容和你能看到的共同记录，不含伴侣的私人原文。文件里可能有敏感内容。", "Downloads a JSON file with your own private content and the shared records you can see, without your partner's private words. It may contain sensitive text.", "Descarga un archivo JSON con tu contenido privado y los registros compartidos que puedes ver, sin las palabras privadas de tu pareja. Puede contener texto sensible.");
    if (action.kind === "delete-private") return t("永久删除你的私人对话、记忆、日常记录、私人提醒、照片和导入的聊天记录。账号、共同内容和同意记录保留。无法撤销，也不能让对方忘记已经看过的内容。", "Permanently deletes your private conversations, memories, check-ins, private reminders, photos and imported chats. Your account, shared content and consent records stay. This cannot be undone or erase what your partner already read.", "Borra para siempre tus conversaciones privadas, recuerdos, registros, recordatorios privados, fotos y chats importados. Tu cuenta, lo compartido y los registros de consentimiento se conservan. Es irreversible y no borra lo que tu pareja ya leyó.");
    if (action.kind === "leave") return t("不需要对方同意。你们的连接会结束，“我们俩”会关闭；以前的共同记录可以在数据下载里找到。你的私人内容留在你自己的空间。", "Your partner's approval is not needed. Your connection ends and Us closes; earlier shared records stay available in your data download. Your private content stays in your own space.", "No necesitas la aprobación de tu pareja. La conexión termina y Nosotros se cierra; el historial compartido sigue en la descarga de datos. Tu contenido privado queda en tu espacio.");
    if (action.kind === "account") return t("会结束你们的连接、退出所有设备、删除你的私人内容，并匿名化你的账号。你在“我们俩”里说过的话和已经确认的约定会保留给对方。删除后无法找回，建议先下载数据。", "This ends your connection, signs out every device, deletes your private content and anonymizes your account. What you wrote in Us and confirmed agreements stay for your partner. It cannot be recovered; consider downloading your data first.", "Termina la conexión, cierra todas las sesiones, borra tu contenido privado y anonimiza tu cuenta. Lo que escribiste en Nosotros y los acuerdos confirmados se conservan para tu pareja. No se puede recuperar; considera descargar tus datos antes.");
    return t("以后共同 AI 不再使用这段摘要，已经确认的约定仍然有效。已经分享的内容无法收回。", "Joint AI will no longer use this summary; confirmed agreements stay valid. What was already shared cannot be taken back.", "La IA compartida dejará de usar este resumen; los acuerdos confirmados siguen vigentes. Lo ya compartido no se puede retirar.");
  };
  const destructive = pending && ["delete-private", "leave", "account"].includes(pending.kind);
  const execute = async () => {
    if (!pending || !confirmed) return; const action = pending; setBusy(true); setNotice(""); keyboard.hide();
    try {
      const body = { password, confirm: true, language };
      if (action.kind === "retention") await relationshipApi("/api/privacy", { method: "PATCH", body: JSON.stringify({ ...body, privateRetentionDays: action.days ?? null }) });
      if (action.kind === "recovery") { const result = await relationshipApi<{ recoveryCode: string }>("/api/privacy/recovery-code", jsonBody(body)); setRecoveryCode(result.recoveryCode); setShowCode(true); }
      if (action.kind === "export") { const result = await relationshipApi<unknown>("/api/privacy/export", jsonBody(body)); downloadFile(JSON.stringify(result, null, 2), "pinky-export.json", "application/json;charset=utf-8"); }
      if (action.kind === "delete-private") await relationshipApi("/api/privacy/delete-private", jsonBody(body));
      if (action.kind === "leave") { await relationshipApi("/api/privacy/leave", jsonBody(body)); await onLeft(); }
      if (action.kind === "account") { await relationshipApi("/api/privacy/account", { method: "DELETE", body: JSON.stringify(body) }); setPending(null); await onDeleted(); return; }
      if (action.kind === "withdraw") await relationshipApi(`/api/privacy/summaries/${action.summary.id}/withdraw`, jsonBody({ confirm: true, language, version: action.summary.version }));
      setPending(null); await load();
      setNotice(action.kind === "export" ? t("数据文件已开始下载。", "Your data file is downloading.", "Tu archivo de datos se está descargando.") : t("已完成。", "Done.", "Listo."));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); setPassword(""); setConfirmed(false); }
  };

  const paired = Boolean(data?.relationships.some((relationship) => ["active", "pending"].includes(relationship.status)));
  const confirmedSummaries = (data?.sharedSummaries || []).filter((summary) => summary.status === "confirmed");
  const summaryIsCurrent = (summary: Summary) => Boolean(summary.relationshipId && data?.relationships.some((relationship) => relationship.id === summary.relationshipId && relationship.status === "active"));
  const titles: Record<Page, string> = { main: t("设置", "Settings", "Ajustes"), membership: t("Pinky 会员", "Pinky membership", "Membresía Pinky"), profile: t("关于我们", "About us", "Sobre nosotros"), processors: t("你的内容会经过谁", "Where your content goes", "Quién procesa tu contenido"), memory: t("Pinky 记得的事", "What Pinky remembers", "Lo que Pinky recuerda"), notifications: t("通知", "Notifications", "Notificaciones"), retention: t("私人内容保留", "Private content", "Contenido privado"), summaries: t("我授权的共同摘要", "Summaries I shared", "Resúmenes que compartí"), history: t("同意与操作记录", "Consent history", "Historial de consentimiento"), recovery: t("恢复码", "Recovery code", "Código de recuperación"), character: t("我们的角色", "Our character", "Nuestro personaje") };

  const main = <>
    <section className="settings-profile">
      <span className="settings-avatar" aria-hidden="true">{(user.name || "?").trim().slice(0, 1).toUpperCase()}</span>
      <div><strong>{user.name}</strong><span>{user.email}</span><em className={partnerName ? "connected" : ""}><Heart size={13} weight="fill" />{partnerName ? t(`已和 ${partnerName} 连接`, `Connected with ${partnerName}`, `Conectado con ${partnerName}`) : t("还没连接另一半", "Not connected with your partner yet", "Aún sin conectar con tu pareja")}</em></div>
    </section>
    <Group>
      <Row icon={<Crown size={18} weight="fill" />} tone="pink" label={titles.membership} value={plan === "member" ? t("已开通", "Active", "Activa") : plan === "free" ? t("免费版", "Free", "Gratis") : ""} onClick={() => open("membership")} testId="settings-membership" />
      <Row icon={<Heart size={18} weight="fill" />} tone="pink" label={titles.profile} value={partnerName ? t(`你、${partnerName}和你们俩`, `You, ${partnerName} and you two`, `Tú, ${partnerName} y ustedes`) : ""} onClick={() => open("profile")} testId="settings-profile" />
    </Group>
    <Group title={t("通用", "General", "General")}>
      <Row icon={<Translate size={18} weight="bold" />} label={t("语言", "Language", "Idioma")}>
        <span className="settings-segmented" role="group" aria-label={t("选择界面语言", "Choose display language", "Elegir idioma de la interfaz")}>{LANGUAGES.map((item) => <button key={item} type="button" className={language === item ? "active" : ""} aria-pressed={language === item} onClick={() => onLanguage(item)}>{item.toUpperCase()}</button>)}</span>
      </Row>
      <Row icon={<Bell size={18} weight="bold" />} tone="red" label={titles.notifications} onClick={() => open("notifications")} testId="settings-notifications" />
      <Row icon={<Sticker size={18} weight="bold" />} tone="pink" label={titles.character} value={characterValue} onClick={() => open("character")} testId="settings-character" />
    </Group>
    <Group note={usShown ? t("“我们俩”是你、TA 和 Pinky 一起的对话。不喜欢可以关掉，只影响你自己的屏幕。", "Us is the chat for you, your partner and Pinky. If it isn't for you, turn it off; it only changes your own screen.", "Nosotros es el chat de ti, tu pareja y Pinky. Si no te gusta, apágalo; solo cambia tu pantalla.") : t("已隐藏：顶部只剩“只有我”，TA 在“我们俩”里说的话你在这里看不到。你们的关系、日历和共享内容都不变，随时可以再打开。", "Hidden: the top shows only Just me, and you won't see what your partner says in Us here. Your relationship, calendar and shared things stay the same; turn it back on anytime.", "Oculto: arriba solo queda Solo yo y aquí no verás lo que tu pareja diga en Nosotros. Su relación, calendario y lo compartido siguen igual; vuelve a activarlo cuando quieras.")}>
      <label className="settings-row settings-switch-row"><span className="settings-icon tone-pink"><UsersThree size={18} weight="bold" /></span><span className="settings-switch-text"><span>{t("显示“我们俩”", "Show Us", "Mostrar Nosotros")}</span></span><input type="checkbox" role="switch" className="settings-switch" checked={usShown} onChange={toggleUs} data-testid="show-us" /></label>
    </Group>
    <Group title={t("隐私", "Privacy", "Privacidad")} note={t("退出关系或管理自己的数据，都不需要对方批准。", "Leaving a relationship or managing your own data never needs your partner's approval.", "Salir de una relación o gestionar tus datos nunca requiere la aprobación de tu pareja.")}>
      <Row icon={<Brain size={18} weight="bold" />} tone="pink" label={titles.memory} onClick={() => open("memory")} testId="settings-memory" />
      <Row icon={<ShieldCheck size={18} weight="bold" />} tone="green" label={titles.processors} onClick={() => open("processors")} testId="settings-processors" />
      <Row icon={<ClockCounterClockwise size={18} weight="bold" />} tone="blue" label={t("私人内容保留", "Keep private content", "Conservar lo privado")} value={data ? period(data.privateRetentionDays) : ""} onClick={() => open("retention")} />
      <Row icon={<Eye size={18} weight="bold" />} tone="pink" label={titles.summaries} value={data ? String(confirmedSummaries.length) : ""} onClick={() => open("summaries")} />
      <Row icon={<ListChecks size={18} weight="bold" />} tone="gray" label={titles.history} onClick={() => open("history")} />
    </Group>
    <Group title={t("账号与数据", "Account and data", "Cuenta y datos")}>
      <Row icon={<Key size={18} weight="bold" />} tone="gray" label={titles.recovery} value={data ? data.recoveryEnabled ? t("已设置", "On", "Activado") : t("未设置", "Off", "Desactivado") : ""} onClick={() => open("recovery")} />
      <Row icon={<DownloadSimple size={18} weight="bold" />} tone="blue" label={t("下载我的数据", "Download my data", "Descargar mis datos")} onClick={() => prepare({ kind: "export" })} />
    </Group>
    <Group title={t("危险操作", "Danger zone", "Zona de riesgo")} note={data ? t(`你现在有 ${data.privateCount} 条私人记录。每一项都会先说明影响，再请你输入密码确认。`, `You have ${data.privateCount} private records. Each step explains what it does and asks for your password first.`, `Tienes ${data.privateCount} registros privados. Cada paso explica lo que hace y pide tu contraseña.`) : undefined}>
      {paired && <Row icon={<LinkBreak size={18} weight="bold" />} tone="red" danger label={t("退出当前关系", "Leave this relationship", "Salir de esta relación")} onClick={() => prepare({ kind: "leave" })} />}
      <Row icon={<Trash size={18} weight="bold" />} tone="red" danger label={t("删除我的私人内容", "Delete my private content", "Borrar mi contenido privado")} onClick={() => prepare({ kind: "delete-private" })} />
      <Row icon={<UserMinus size={18} weight="bold" />} tone="red" danger label={t("删除账号", "Delete account", "Borrar la cuenta")} onClick={() => prepare({ kind: "account" })} />
    </Group>
    <Group>
      <Row icon={<SignOut size={18} weight="bold" />} tone="gray" label={t("退出登录", "Sign out", "Cerrar sesión")} onClick={onLogout} testId="settings-logout" />
    </Group>
    <p className="settings-footer">Pinky · {t("版本", "Version", "Versión")} 1.0</p>
  </>;

  const processors: Array<[string, string]> = [
    [t("私聊与语音", "Private chats and voice", "Chats privados y voz"), t("由 AI 服务处理，我们要求它不保存这些内容。", "Processed by our AI provider, which we ask not to keep them.", "Los procesa nuestro proveedor de IA, al que pedimos no guardarlos.")],
    ["iMessage", t("如果你用 iMessage 和 Pinky 聊天，消息会经过 Apple 和 Sendblue。", "If you talk to Pinky over iMessage, messages pass through Apple and Sendblue.", "Si hablas con Pinky por iMessage, los mensajes pasan por Apple y Sendblue.")],
    [t("推送通知", "Push notifications", "Notificaciones"), t("经过 Apple 或 Google，内容只有一句含糊的话，不含你们聊的细节。", "Pass through Apple or Google and say only something vague, never the details.", "Pasan por Apple o Google y solo dicen algo vago, nunca los detalles.")],
    [t("“我们俩”", "Us", "Nosotros"), t("你们两人都能看到这里的全部内容。", "You both see everything in it.", "Los dos ven todo lo que hay en ella.")],
    [t("导入的聊天记录", "Imported chats", "Chats importados"), t("只有导入的人能看到；对方同意后才会有一份共享的分析。", "Only the person who imported them can see them; a shared analysis exists only after the other agrees.", "Solo los ve quien los importó; un análisis compartido existe solo si el otro acepta.")],
    [t("删除账号后", "After deleting your account", "Después de borrar la cuenta"), t("你在“我们俩”里说过的话会留给对方。", "What you wrote in Us stays for your partner.", "Lo que escribiste en Nosotros queda para tu pareja.")],
  ];
  const sub: Record<Exclude<Page, "main">, ReactNode> = {
    membership: <MembershipPage language={language} userId={user.id} partnerName={partnerName} />,
    profile: <ProfilePage language={language} onAsk={onAsk} />,
    notifications: <NotificationSettings language={language} />,
    character: <>
      <CharacterMaker language={language} paired={Boolean(relationshipId)} character={character} onChange={setCharacter} />
      {character?.image && <Group note={character.uploadedByMe ? t("由你上传。只影响你自己的屏幕，TA 那边照常显示。", "You uploaded it. This only changes your own screen; your partner still sees it.", "Lo subiste tú. Solo cambia tu pantalla; tu pareja lo sigue viendo.") : t(`由 ${partnerName || "TA"} 上传。只影响你自己的屏幕，TA 那边照常显示。`, `${partnerName || "Your partner"} uploaded it. This only changes your own screen; they still see it.`, `Lo subió ${partnerName || "tu pareja"}. Solo cambia tu pantalla; tu pareja lo sigue viendo.`)}>
        <label className="settings-row settings-switch-row"><span className="settings-icon tone-pink"><Sticker size={18} weight="bold" /></span><span className="settings-switch-text"><span>{t("在对话顶部显示", "Show at the top of the chat", "Mostrar arriba del chat")}</span></span><input type="checkbox" role="switch" className="settings-switch" checked={character.visible} onChange={() => void toggleCharacter()} data-testid="character-visible" /></label>
      </Group>}
      {characterNotice && <p className="settings-error" role="alert">{characterNotice}</p>}
    </>,
    memory: <><p className="settings-intro">{t("这些是 Pinky 为了更懂你们而记下的偏好和经验，比如“吵架时先安静十分钟”。你说“记住……”时它会记下；这里可以查看、修改、删除，以及决定 AI 能不能用。", "These are preferences and lessons Pinky keeps to understand you better, like “take ten quiet minutes before talking”. It keeps one when you say “remember…”; here you can review, edit or delete them and decide whether AI may use them.", "Son preferencias y aprendizajes que Pinky guarda para entenderlos mejor, como «diez minutos de calma antes de hablar». Guarda uno cuando dices «recuerda…»; aquí puedes revisarlos, editarlos o borrarlos y decidir si la IA puede usarlos.")}</p><MemoryWorkspace language={language} userId={user.id} relationshipId={relationshipId} compose={false} /></>,
    processors: <Group>{processors.map(([title, text]) => <div key={title} className="settings-row settings-text-row"><strong>{title}</strong><p>{text}</p></div>)}</Group>,
    retention: <Group note={t("按最后一次更新的时间计算，只包括私人对话、私人记忆和日常记录。", "Counted from the last change; covers only private conversations, private memories and check-ins.", "Se cuenta desde el último cambio; solo incluye conversaciones privadas, recuerdos privados y registros diarios.")}>
      {[null, 7, 30, 90, 365].map((value) => <button key={String(value)} type="button" className="settings-row" onClick={() => value !== data?.privateRetentionDays && prepare({ kind: "retention", days: value })}><span className="settings-label">{period(value)}</span>{value === (data?.privateRetentionDays ?? null) && <Check size={18} weight="bold" className="settings-check" />}</button>)}
    </Group>,
    summaries: confirmedSummaries.length ? <Group note={t("关系记忆有单独的双人授权，在“回忆”里管理。", "Relationship memories have their own two-person consent, managed in Moments.", "Los recuerdos tienen su propio consentimiento de ambos, en Momentos.")}>{confirmedSummaries.map((summary) => <div key={summary.id} className="settings-row settings-text-row"><p>{summary.text}</p><small>v{summary.version} · {!summaryIsCurrent(summary) ? t("关系已结束，不再使用", "Relationship ended; no longer used", "Relación terminada; ya no se usa") : summary.withdrawnAt || summary.aiAccessScope === "none" ? t("已停止 AI 使用", "AI use stopped", "Uso de IA detenido") : t("共同 AI 可以使用", "Joint AI may use it", "La IA compartida puede usarlo")}</small>{summaryIsCurrent(summary) && !summary.withdrawnAt && summary.aiAccessScope !== "none" && <button type="button" className="settings-link" disabled={busy} onClick={() => prepare({ kind: "withdraw", summary })}>{t("停止 AI 使用", "Stop AI use", "Detener uso de IA")}</button>}</div>)}</Group> : <p className="settings-empty">{t("你还没有确认分享过摘要。", "You haven't shared any summaries yet.", "Aún no compartiste resúmenes.")}</p>,
    history: data?.consentHistory.length ? <Group note={t("最近 50 条，不含私人原文。", "The latest 50, without private words.", "Los últimos 50, sin textos privados.")}>{data.consentHistory.map((event, index) => <div key={`${event.createdAt}:${index}`} className="settings-row settings-text-row"><strong>{consentLabel(event.eventType, language)}{event.sourceVersion ? ` · v${event.sourceVersion}` : ""}</strong><small>{new Date(event.createdAt).toLocaleString(languageTag(language), { dateStyle: "medium", timeStyle: "short" })}</small></div>)}</Group> : <p className="settings-empty">{t("还没有记录。", "Nothing yet.", "Aún no hay nada.")}</p>,
    recovery: <>
      <Group note={t("还没有邮箱找回。忘记密码时，只能用恢复码重设。", "Email recovery isn't available yet. If you forget your password, the recovery code is the only way back in.", "Aún no hay recuperación por correo. Si olvidas la contraseña, el código es la única forma de volver a entrar.")}>
        <Row icon={<Key size={18} weight="bold" />} tone="gray" label={t("状态", "Status", "Estado")} value={data?.recoveryEnabled ? t("已设置", "On", "Activado") : t("未设置", "Off", "Desactivado")} />
        <button type="button" className="settings-row settings-action" onClick={() => prepare({ kind: "recovery" })}>{data?.recoveryEnabled ? t("更换恢复码", "Replace recovery code", "Reemplazar código") : t("生成恢复码", "Generate recovery code", "Generar código")}</button>
      </Group>
      {recoveryCode && <section className="settings-code" role="status"><strong>{t("这是你的新恢复码，只显示这一次", "Your new recovery code, shown only once", "Tu nuevo código, solo se muestra una vez")}</strong>{showCode ? <code>{recoveryCode}</code> : <p>••••••••••••</p>}
        <div><button type="button" onClick={() => downloadFile(`${t("Pinky 一次性恢复码，请安全保存。", "Pinky one-time recovery code. Keep it safe.", "Código de un solo uso de Pinky. Guárdalo bien.")}\n\n${recoveryCode}\n`, "pinky-recovery-code.txt", "text/plain;charset=utf-8")}><DownloadSimple size={16} />{t("保存到文件", "Save to a file", "Guardar en un archivo")}</button><button type="button" className="quiet" onClick={() => setShowCode(!showCode)}>{showCode ? t("隐藏", "Hide", "Ocultar") : t("显示", "Show", "Mostrar")}</button><button type="button" className="quiet" onClick={() => { setRecoveryCode(""); setShowCode(false); }}>{t("我已保存", "I saved it", "Ya lo guardé")}</button></div></section>}
    </>,
  };

  return <div className="paper-screen relationship-shell settings-screen">
    {/* A page opened straight from the conversation (the character, from the tour) goes back there; others go back to Settings. */}
    <PageHeader language={language} title={titles[page]} {...(page === "main" || page === initialPage ? { onBack } : { onBack: () => open("main"), backLabel: titles.main })} />
    <main className="relationship-main settings-main"><div className="settings-body" data-testid="settings-screen">
      {page === "main" ? main : sub[page]}
      {notice && !pending && <p className="settings-notice" role="status">{notice}</p>}
    </div></main>
    <BottomSheet open={Boolean(pending)} onOpenChange={(next) => { if (!next) close(); }} title={pending ? actionTitle(pending) : ""} snap={0.8}>
      {pending && <form className="settings-sheet" onSubmit={(event) => { event.preventDefault(); void execute(); }}>
        <p>{actionDescription(pending)}</p>
        {pending.kind === "withdraw" && <blockquote>{pending.summary.text}</blockquote>}
        {/* The checkbox comes first so the sheet opens without focusing the password field and raising the keyboard. */}
        <label className="settings-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t("我明白上面的影响", "I understand what this does", "Entiendo lo que hace")}</span></label>
        {pending.kind !== "withdraw" && <label><span>{t("输入当前密码", "Enter your password", "Escribe tu contraseña")}</span><KeyboardInput type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={() => keyboard.hide()} /></label>}
        {notice && <p className="settings-error" role="alert">{notice}</p>}
        <button type="submit" className={destructive ? "danger" : ""} disabled={busy || !confirmed || (pending.kind !== "withdraw" && !password)}>{busy ? t("正在处理…", "Working…", "Procesando…") : actionTitle(pending)}</button>
        <button type="button" className="quiet" disabled={busy} onClick={close}>{t("取消", "Cancel", "Cancelar")}</button>
      </form>}
    </BottomSheet>
  </div>;
}

function consentLabel(eventType: string, language: Language) {
  const labels: Record<string, [string, string, string]> = {
    "privacy.retention_changed": ["更新私人保留期限", "Private retention updated", "Conservación privada actualizada"], "privacy.private_data_deleted": ["删除私人内容", "Private content deleted", "Contenido privado borrado"], "account.recovery_code_rotated": ["生成新恢复码", "New recovery code generated", "Nuevo código generado"], "account.recovered": ["使用恢复码找回账号", "Account recovered with code", "Cuenta recuperada con código"], "relationship.left": ["退出关系", "Left relationship", "Salida de la relación"], "summary.ai_access_withdrawn": ["撤回摘要 AI 使用", "Summary AI use withdrawn", "Uso de IA del resumen retirado"],
    "memory.created": ["保存私人记忆", "Private memory saved", "Recuerdo privado guardado"], "memory.corrected": ["纠正记忆并更新授权", "Memory corrected and consent updated", "Recuerdo corregido y permiso actualizado"], "memory.shared": ["确认分享记忆候选", "Memory candidate shared", "Propuesta de recuerdo compartida"], "memory.ai_approved": ["批准当前版本的记忆 AI 使用", "Current memory version approved for AI", "Versión actual del recuerdo autorizada para IA"], "memory.ai_withdrawn": ["撤回记忆 AI 使用", "Memory AI use withdrawn", "Uso de IA del recuerdo retirado"], "memory.archived": ["归档私人记忆", "Private memory archived", "Recuerdo privado archivado"], "memory.deleted": ["删除私人记忆", "Private memory deleted", "Recuerdo privado borrado"], "checkin.created": ["保存私人日常记录", "Private check-in saved", "Registro privado guardado"], "checkin.shared": ["确认分享日常记录", "Check-in share confirmed", "Registro compartido confirmado"], "checkin.deleted": ["删除私人日常记录", "Private check-in deleted", "Registro privado borrado"],
  };
  return labels[eventType] ? localized(language, ...labels[eventType]) : localized(language, "已记录的内容或授权操作", "Recorded content or consent action", "Acción registrada de contenido o permiso");
}
