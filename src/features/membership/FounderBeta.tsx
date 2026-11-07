import { useEffect, useState } from "react";
import { Copy, Plus } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";

// 内测看板 (founder only): make invite codes for the first real couples and see how each couple is doing, by counts only.
type Code = { code: string; days: number; note: string; used: boolean; usedAt: string | null; createdAt?: string };
type Couple = { label: string; since: string | null; beta: boolean; code: string | null; note: string; plan: string; source: string | null; activeMembers: number; actions: number; topActions: Array<[string, number]>; aiCalls: number; aiDays: number; lastAiDay: string | null; feedback: number };
export type BetaReport = { codes: Code[]; couples: Couple[] };

export function FounderBeta({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [data, setData] = useState<BetaReport | null>(null);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const load = async () => { try { setData(await relationshipApi<BetaReport>("/api/founder/beta")); } catch (error) { setNotice((error as Error).message); } };
  useEffect(() => { void load(); }, []);
  const make = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try { await relationshipApi("/api/founder/beta/codes", jsonBody({ count: 1, days: 90, note })); setNote(""); await load(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const link = (code: string) => `${location.origin}/?view=membership&beta=${code}`;
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(link(code)); setNotice(t("邀请链接已复制。", "Invite link copied.", "Enlace copiado.")); } catch { setNotice(link(code)); } };
  if (!data) return <p className="membership-loading">{notice || t("正在读取…", "Loading…", "Cargando…")}</p>;
  const beta = data.couples.filter((couple) => couple.beta), active = beta.filter((couple) => couple.activeMembers > 0).length;
  return <div className="founder" data-testid="founder-beta">
    <section className="founder-sum">
      <div><b>{data.codes.length}</b><span>{t("内测码", "Codes", "Códigos")}</span></div>
      <div><b>{data.codes.filter((code) => code.used).length}</b><span>{t("已用", "Used", "Usados")}</span></div>
      <div><b>{active}/{beta.length}</b><span>{t("本周活跃", "Active this week", "Activas esta semana")}</span></div>
    </section>
    <section className="founder-card">
      <h3>{t("生成邀请码", "New invite code", "Nuevo código")}</h3>
      <p className="founder-hint">{t("每个码给一对情侣 90 天会员。备注只有你看得到，比如“小王和女朋友”。", "Each code gives one couple 90 days of membership. The note is only for you.", "Cada código da a una pareja 90 días de membresía. La nota es solo para ti.")}</p>
      <div className="founder-make"><KeyboardInput value={note} maxLength={60} placeholder={t("备注（可选）", "Note (optional)", "Nota (opcional)")} onChange={(event) => setNote(event.target.value)} onBlur={() => keyboard.hide()} aria-label={t("备注", "Note", "Nota")} /><button type="button" disabled={busy} onClick={() => void make()} data-testid="founder-make"><Plus size={16} weight="bold" />{t("生成", "Make", "Crear")}</button></div>
      <ul className="founder-codes">{data.codes.slice().reverse().map((code) => <li key={code.code}><span><b>{code.code}</b>{code.note && <small>{code.note}</small>}</span><em className={code.used ? "used" : ""}>{code.used ? t("已用", "Used", "Usado") : t("未用", "Unused", "Sin usar")}</em>{!code.used && <button type="button" onClick={() => void copy(code.code)} aria-label={t("复制邀请链接", "Copy invite link", "Copiar enlace")}><Copy size={16} /></button>}</li>)}</ul>
    </section>
    <section className="founder-card">
      <h3>{t("每对情侣（最近 7 天，只有次数，没有内容）", "Each couple (last 7 days; counts only, no content)", "Cada pareja (7 días; solo conteos)")}</h3>
      {!data.couples.length && <p className="founder-hint">{t("还没有情侣。", "No couples yet.", "Aún no hay parejas.")}</p>}
      <ul className="founder-couples">{data.couples.map((couple) => <li key={couple.label}>
        <header><b>{t(`情侣 ${couple.label}`, `Couple ${couple.label}`, `Pareja ${couple.label}`)}</b>{couple.beta && <em>{t("内测", "Beta", "Beta")}{couple.note ? ` · ${couple.note}` : ""}</em>}<span>{couple.plan === "member" ? t("会员", "Member", "Miembro") : t("免费", "Free", "Gratis")}</span></header>
        <p>{t(`本周来了 ${couple.activeMembers}/2 人 · ${couple.actions} 次操作 · AI ${couple.aiCalls} 次（${couple.aiDays} 天）· 反馈 ${couple.feedback}`, `${couple.activeMembers}/2 came this week · ${couple.actions} actions · AI ${couple.aiCalls} (${couple.aiDays} days) · feedback ${couple.feedback}`, `${couple.activeMembers}/2 esta semana · ${couple.actions} acciones · IA ${couple.aiCalls} (${couple.aiDays} días) · comentarios ${couple.feedback}`)}</p>
        {!!couple.topActions.length && <small>{couple.topActions.map(([name, count]) => `${name} ${count}`).join(" · ")}</small>}
      </li>)}</ul>
    </section>
    {notice && <p className="membership-notice" role="status">{notice}</p>}
  </div>;
}
