import { useEffect, useRef, useState } from "react";
import { Copy, ShareNetwork, Gift, X } from "@phosphor-icons/react";
import { counted, languageTag, localized, type Language } from "../../i18n";
import { BottomSheet } from "../navigation/Sheet";
import { inIosApp } from "./MembershipPage";
import { loadReferrals, referralInstallId, type ReferralAccount, type ReferralPreview, type Reward } from "./referrals";
import { relationshipApi } from "../relationship/api";
import "./referrals.css";

export const inviteTitle = (language: Language) => localized(language, "邀请好友", "Invite friends", "Invitar a amigos");
const date = (iso: string, lang: Language) => new Date(iso).toLocaleDateString(languageTag(lang), { year: "numeric", month: "short", day: "numeric" });
const days = (n: number, language: Language) => localized(language, `${n} 天`, counted(n, "day", "days"), counted(n, "día", "días"));
const rewardName = (source: Reward["source"], lang: Language) => source === "referral" ? localized(lang, "邀请奖励", "Referral reward", "Por invitación") : localized(lang, "反馈已修复", "Reported bug fixed", "Problema corregido");

export function SignupReferral({ code, language, remove }: { code: string; language: Language; remove: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [preview, setPreview] = useState<ReferralPreview | null>(null);
  const [error, setError] = useState<"missing" | "retry" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setPreview(null); setError(null);
    void relationshipApi<ReferralPreview>(`/api/referrals/preview?code=${encodeURIComponent(code)}`, { signal: request.signal, cache: "no-store", headers: { "x-install-id": referralInstallId() } })
      .then(data => { if (!request.signal.aborted) setPreview(data); })
      .catch(err => { if (!request.signal.aborted) setError(err.status === 404 ? "missing" : "retry"); });
    return () => request.abort();
  }, [code, attempt]);
  const friend = preview?.initial || t("好友", "your friend", "tu amigo");
  return <div className="auth-hint referral-preview" data-testid="referral-preview" aria-live="polite">
    {preview ? t(`注册后 ${preview.rules.windowDays} 天内，在至少 ${preview.rules.days} 天使用 AI 共 ${preview.rules.calls} 次，你和 ${friend} 都将获得 ${days(preview.rules.rewardDays, language)}会员。`, `Use AI ${preview.rules.calls} times across at least ${preview.rules.days} days in your first ${preview.rules.windowDays} days, and you and ${friend} will each get ${days(preview.rules.rewardDays, language)} of membership.`, `Usa la IA ${preview.rules.calls} veces en al menos ${preview.rules.days} días durante los primeros ${preview.rules.windowDays} días y tú y ${friend} recibirán ${days(preview.rules.rewardDays, language)} de membresía cada uno.`) :
      error === "missing" ? t("这个好友邀请已失效。", "This invitation is no longer valid.", "Esta invitación ya no es válida.") :
      error ? t("暂时无法读取邀请。", "Couldn’t load the invitation.", "No se pudo cargar la invitación.") : t("正在读取好友邀请…", "Loading invitation…", "Cargando la invitación…")}
    {error === "retry" && <button type="button" className="referral-text-button" onClick={() => setAttempt(n => n + 1)}>{t("重试", "Retry", "Reintentar")}</button>}
    {error && <button type="button" className="referral-text-button" onClick={remove}>{t("不使用邀请注册", "Register without the invitation", "Registrarme sin invitación")}</button>}
  </div>;
}

export function ReferralPage({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [data, setData] = useState<ReferralAccount | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const request = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      setFailed(false);
      void loadReferrals(request.signal).then(value => { if (!request.signal.aborted) setData(value); })
        .catch(() => { if (!request.signal.aborted) setFailed(true); });
    };
    refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { request.abort(); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [attempt]);
  const retry = <div className="referral-error" role="alert">{t("暂时无法更新奖励，请检查网络后重试。", "Couldn’t refresh your rewards. Check your connection and try again.", "No se pudieron actualizar tus recompensas. Revisa tu conexión e inténtalo de nuevo.")} <button type="button" className="referral-text-button" onClick={() => setAttempt(n => n + 1)}>{t("重试", "Retry", "Reintentar")}</button></div>;
  if (!data) return failed ? retry : <p role="status">{t("正在读取邀请和奖励…", "Loading invitations and rewards…", "Cargando invitaciones y recompensas…")}</p>;
  const { rules } = data;
  const link = new URL("/", location.origin);
  link.searchParams.set("ref", data.code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.href); setNotice(t("链接已复制。", "Link copied.", "Enlace copiado.")); }
    catch { setNotice(t("请长按上面的链接复制。", "Press and hold the link above to copy it.", "Mantén pulsado el enlace de arriba para copiarlo.")); }
  };
  const share = async () => {
    setNotice("");
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: "Ourever", text: t("邀请你一起试试 Ourever。", "Join me on Ourever.", "Te invito a probar Ourever."), url: link.href }); }
    catch (err) { if ((err as Error).name !== "AbortError") setNotice(t("分享未完成，可以复制链接。", "Sharing didn’t finish. You can copy the link instead.", "No se compartió. Puedes copiar el enlace.")); }
  };
  const status = (item: NonNullable<ReferralAccount["received"]>) => {
    switch (item.state) {
      case "using": return t(`使用中 · ${item.activeDays}/${rules.days} 天`, `In progress · ${item.activeDays}/${rules.days} days`, `En curso · ${item.activeDays}/${rules.days} días`);
      case "activated": return t("已达成", "Qualified", "Completado");
      case "capped": return t("已达成 · 本月已达上限", "Qualified · monthly limit reached", "Completado · límite mensual alcanzado");
      case "expired": return t("邀请已到期", "Invitation expired", "Invitación caducada");
      default: return t("已注册", "Registered", "Registrado");
    }
  };
  return <div className="referrals-page" data-testid="referrals-page">
    {failed && retry}
    <section className="referral-section">
      <h2>{t("你的邀请链接", "Your invitation link", "Tu enlace de invitación")}</h2>
      <p>{t(`好友通过此链接注册后，在头 ${rules.windowDays} 天里，在至少 ${rules.days} 个不同的日子收到 Ourever 的 ${rules.calls} 条回复，你们就各得 ${days(rules.rewardDays, language)}会员。`, `When a friend signs up with your link and, in their first ${rules.windowDays} days, gets ${rules.calls} replies from Ourever on at least ${rules.days} different days, you each get ${days(rules.rewardDays, language)} of membership.`, `Si un amigo se registra con tu enlace y, en sus primeros ${rules.windowDays} días, recibe ${rules.calls} respuestas de Ourever en al menos ${rules.days} días distintos, cada uno recibe ${days(rules.rewardDays, language)} de membresía.`)}</p>
      <a href={link.href} className="referral-link" data-testid="referral-link">{link.href}</a>
      <div className="referral-actions">
        <button type="button" className="card-primary" onClick={() => void share()}><ShareNetwork size={17} />{t("分享", "Share", "Compartir")}</button>
        <button type="button" className="card-secondary" onClick={() => void copy()}><Copy size={17} />{t("复制链接", "Copy link", "Copiar enlace")}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="referral-section">
      <h2>{t("邀请进度", "Invitation progress", "Progreso de invitaciones")}</h2>
      <p>{t(`本月已获邀请奖励 ${data.monthCount}/${rules.monthlyCap} 次。`, `Referral rewards this month: ${data.monthCount}/${rules.monthlyCap}.`, `Recompensas por invitación este mes: ${data.monthCount}/${rules.monthlyCap}.`)}</p>
      {data.received && <p>{t("我收到的邀请", "My invitation", "La invitación que recibí")} · {status(data.received)}</p>}
      {data.invited.length ? <ul>{data.invited.map((item, index) => <li key={index}><span className="referral-initial">{item.initial || "•"}</span><span>{status(item)}</span></li>)}</ul> :
        <p className="referral-empty">{t("还没有好友通过你的链接注册。", "No friends have signed up with your link yet.", "Aún no se ha registrado nadie con tu enlace.")}</p>}
    </section>
    <section className="referral-section">
      <h2>{t("会员奖励", "Membership rewards", "Recompensas de membresía")}</h2>
      <strong>{t(`累计获得 ${days(data.totalDays, language)}`, `${days(data.totalDays, language)} earned in total`, `${days(data.totalDays, language)} recibidos en total`)}</strong>
      {data.rewards.length ? <ul>{data.rewards.map((reward, index) => <li key={index}><div>{rewardName(reward.source, language)}<small>{date(reward.at, language)} · {t("会员至", "Member until", "Membresía hasta")} {date(reward.until, language)}</small></div><b>+{days(reward.days, language)}</b></li>)}</ul> :
        <p className="referral-empty">{t("邀请达标或你反馈的问题修复后，可在这里查看到账记录。", "Rewards appear here when an invitation qualifies or a bug you reported is fixed.", "Aquí verás las recompensas cuando una invitación cumpla los requisitos o se corrija un fallo que reportaste.")}</p>}
    </section>
  </div>;
}

export function ReferralNotices({ userId, language, openPage, openFeedback }: { userId: string; language: Language; openPage: (page: "referrals" | "membership") => void; openFeedback: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [reward, setReward] = useState<Reward | null>(null);
  const [sheet, setSheet] = useState<"limit" | "options" | null>(null);
  const dismissed = useRef("");
  const seenKey = "ourever.reward.seen:" + userId;
  useEffect(() => {
    const request = new AbortController();
    let pendingReferral = false;
    let loading = false;
    try { dismissed.current = localStorage.getItem(seenKey) || ""; } catch { /* private browsing */ }
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const account = await loadReferrals(request.signal);
        if (request.signal.aborted) return;
        pendingReferral = !!account.received && ["registered", "using"].includes(account.received.state);
        const latest = account.rewards.reduce<Reward | null>((current, item) => !current || item.at > current.at ? item : current, null);
        if (latest && latest.at > dismissed.current) setReward(latest);
      } catch { /* Retry on foreground or next interactive use. */ }
      finally { loading = false; }
    };
    const used = () => { if (pendingReferral) void refresh(); };
    const limit = () => setSheet("limit");
    // The invited partner can qualify on the other device while this page stays open.
    const timer = window.setInterval(used, 60000);
    const marked = (event: StorageEvent) => { if (event.key === seenKey && event.newValue) { dismissed.current = event.newValue; setReward(null); } };
    void refresh();
    window.addEventListener("ourever:free-limit", limit);
    window.addEventListener("toward-us:assistant-changed", used);
    window.addEventListener("storage", marked);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { request.abort(); window.clearInterval(timer); window.removeEventListener("ourever:free-limit", limit); window.removeEventListener("toward-us:assistant-changed", used); window.removeEventListener("storage", marked); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [seenKey]);
  const dismissReward = () => {
    if (reward) { dismissed.current = reward.at; try { localStorage.setItem(seenKey, reward.at); } catch { /* this visit only */ } }
    setReward(null);
  };
  const go = (page: "referrals" | "membership") => { setSheet(null); dismissReward(); openPage(page); };
  return <>
    {reward && !sheet && <aside className="reward-arrival" role="status" data-testid="reward-arrival"><Gift size={20} /><button type="button" onClick={() => go("referrals")}>{t(`${rewardName(reward.source, language)}已到账：${days(reward.days, language)}会员`, `${rewardName(reward.source, language)}: ${days(reward.days, language)} of membership added`, `${rewardName(reward.source, language)}: se sumaron ${days(reward.days, language)} de membresía`)}</button><button type="button" aria-label={t("关闭", "Close", "Cerrar")} onClick={dismissReward}><X size={18} /></button></aside>}
    <BottomSheet snap={0.42} open={!!sheet} onOpenChange={open => { if (!open) setSheet(null); }} title={sheet === "options" ? t("赚取会员天数", "Earn free membership", "Obtén membresía gratis") : t("免费额度已用完", "Your free allowance is used up", "Has agotado el cupo gratuito")}>
      <div className="referral-options">
        {sheet === "options" ? <><p>{t("内测期间，邀请达标或反馈的问题修复后，都能免费获得会员天数。", "During the beta you can earn membership days through qualified invitations or bug reports that lead to a fix.", "Durante la beta puedes ganar días de membresía con invitaciones válidas o al reportar fallos que se corrijan.")}</p><button type="button" className="card-primary" onClick={() => go("referrals")}>{inviteTitle(language)}</button><button type="button" className="card-secondary" onClick={() => { setSheet(null); openFeedback(); }}>{t("反馈问题", "Report a bug", "Reportar un fallo")}</button></> :
          inIosApp() ? <><p>{t("免费额度明天恢复。", "Your free allowance resets tomorrow.", "Tu cupo gratuito se renueva mañana.")}</p><button type="button" className="card-primary" onClick={() => go("referrals")}>{inviteTitle(language)}</button></> :
          <><p>{t("你可以升级会员，或邀请好友获得会员天数。", "You can upgrade or invite a friend to earn membership days.", "Puedes mejorar tu plan o invitar a alguien para ganar días de membresía.")}</p><button type="button" className="card-primary" onClick={() => go("membership")}>{t("升级会员", "Upgrade membership", "Mejorar mi plan")}</button><button type="button" className="card-secondary" onClick={() => go("referrals")}>{inviteTitle(language)}</button></>}
      </div>
    </BottomSheet>
  </>;
}
