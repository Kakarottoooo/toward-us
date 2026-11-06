import { useEffect, useState } from "react";
import { CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord, RelationshipHomePayload } from "../relationship/types";
import { PromiseList } from "../promises/PromiseList";
import "./agreements.css";

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

/** 我们说好的 (founder 11-06): the top of Coming up, not a page of its own. What they promised each other, reviews that are due,
 * agreements waiting for approval (approved right here or on the card in Us), those in effect with their undated parts, and
 * earlier ones folded away. Dated parts are on the calendar below like any other to-do. Nothing shows until there is something. */
export function AgreementsPage({ language, userId, payload, onChanged, onReview }: { language: Language; userId: string; payload: RelationshipHomePayload; onChanged: () => void | Promise<void>; onReview: (outcomeId: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  // What this member last told Pinky about each of their promises; only they see it.
  const [answers, setAnswers] = useState<Record<string, { done: boolean; at: string }>>({});
  useEffect(() => { relationshipApi<{ promises: Record<string, { done: boolean; at: string }> }>("/api/assistant/promises").then((result) => setAnswers(result.promises)).catch(() => {}); }, []);
  const { agreements, approvals, commitments } = payload.graph;
  const approvedByMe = (agreement: GraphRecord) => approvals.some((item) => item.agreementId === agreement.id && item.approvedVersion === agreement.version && item.ownerUserId === userId && !item.withdrawnAt);
  const decide = async (agreement: GraphRecord, action: "approve" | "request-change") => {
    setBusy(agreement.id); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${agreement.id}/${action}`, jsonBody({ version: agreement.version, language })); await onChanged(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  const groups = [
    { key: "waiting", title: t("等你们批准", "Waiting for approval", "Esperando aprobación"), items: agreements.filter((item) => item.status === "awaiting_approvals") },
    // A version someone asked to change stays in view, with who asked and why, until a new version goes out for approval.
    { key: "changing", title: t("有人要求修改", "Change requested", "Cambio solicitado"), items: agreements.filter((item) => item.status === "draft") },
    { key: "active", title: t("我们说好的", "What we agreed", "Lo que acordamos"), items: agreements.filter((item) => item.status === "active") },
    { key: "past", title: t("以前的", "Earlier", "Anteriores"), items: agreements.filter((item) => !["awaiting_approvals", "active", "draft"].includes(item.status)) },
  ].filter((group) => group.items.length);
  const reviews = payload.home.pending.filter((item) => item.type === "outcome_review");
  const status = (agreement: GraphRecord) => agreement.status === "awaiting_approvals" ? (approvedByMe(agreement) ? t("你已批准，等 TA 批准", "You approved; waiting for your partner", "Ya aprobaste; esperando a tu pareja") : t("等你批准这一版", "Waiting for your approval of this version", "Espera tu aprobación de esta versión")) : agreement.status === "active" ? t("你们俩都批准了", "Both of you approved", "Los dos lo aprobaron") : agreement.status === "draft" ? t("等新版本：在“我们俩”里让 Pinky 重新起草，两人再批准", "Waiting for a new version: ask Pinky in Us to redraft it, then both approve", "Esperando una nueva versión: pídele a Pinky en Nosotros que lo redacte y aprueben los dos") : agreement.status === "renegotiation_requested" ? t("有人想重新商量", "Someone asked to revisit it", "Alguien pidió revisarlo") : t("已结束", "Closed", "Cerrado");
  const partnerName = payload.relationship.members.find((member) => member.id !== userId)?.name || t("TA", "Your partner", "Tu pareja");
  // Who asked for the change and why, in their own words; the server keeps both on the shared agreement.
  const changeNote = (agreement: GraphRecord) => {
    if (agreement.status !== "draft") return null;
    const who = payload.relationship.members.find((member) => member.id === agreement.changedByUserId)?.name || "", why = String(agreement.changeReason || "").trim();
    if (!who && !why) return null;
    return why ? t(`${who || "有人"} 想改：${why}`, `${who || "Someone"} wants a change: ${why}`, `${who || "Alguien"} quiere cambiar: ${why}`) : t(`${who} 想改这一版`, `${who} asked for a change`, `${who} pidió un cambio`);
  };
  const card = (agreement: GraphRecord, key: string) => {
    // Parts with a day are on the calendar below like any to-do; only the undated ones (habits, rules) are listed here.
    const terms = strings(agreement.terms), open = strings(agreement.unresolvedPoints), mine = commitments.filter((item) => item.agreementId === agreement.id && !item.archivedAt && !item.dueAt);
    return <article key={agreement.id} className={`agreement-item is-${key}`}>
      <header><strong>{String(agreement.title || "")}</strong><small>{t(`第 ${agreement.version} 版`, `Version ${agreement.version}`, `Versión ${agreement.version}`)} · {new Date(agreement.updatedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })}</small></header>
      {changeNote(agreement) && <p className="agreement-change" data-testid="agreement-change">{changeNote(agreement)}</p>}
      {!!agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title && <p>{String(agreement.summary)}</p>}
      {!!terms.length && <ol>{terms.map((term, index) => <li key={index}>{term}</li>)}</ol>}
      {!!open.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{open.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}
      {!!mine.length && <ul className="agreement-commitments">{mine.map((item) => <li key={item.id}>{String(item.description || "")}{answers[item.id] && <small className={`agreement-answer ${answers[item.id].done ? "done" : ""}`}>{answers[item.id].done ? t("你说做到了", "You said you did it", "Dijiste que lo cumpliste") : t("你说还没做到", "You said not yet", "Dijiste que aún no")} · {new Date(answers[item.id].at).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })} · {t("只有你看得到", "only you see this", "solo tú lo ves")}</small>}</li>)}</ul>}
      <footer><span className="card-state">{agreement.status === "active" && <CheckCircle size={16} weight="fill" />}{status(agreement)}</span>
        {agreement.status === "awaiting_approvals" && !approvedByMe(agreement) && <div className="card-actions"><button className="card-primary" disabled={busy === agreement.id} onClick={() => void decide(agreement, "approve")}><CheckCircle size={18} weight="fill" />{t(`批准第 ${agreement.version} 版`, `Approve v${agreement.version}`, `Aprobar v${agreement.version}`)}</button><button disabled={busy === agreement.id} onClick={() => void decide(agreement, "request-change")}>{t("要改", "Request change", "Pedir cambio")}</button></div>}
      </footer>
    </article>;
  };
  const past = groups.find((group) => group.key === "past");
  return <div className="agreements-page" data-testid="agreements">
    {notice && <p className="space-error" role="alert">{notice}</p>}
    {/* What the two of them promised each other in conversation comes first: it is what Pinky follows up on (11-03). */}
    <PromiseList language={language} partnerName={partnerName} refreshKey={payload} onChanged={onChanged} hideEmpty />
    {reviews.map((item) => <button key={item.id} className="agreement-review" onClick={() => onReview(item.id)}><ClockCounterClockwise size={20} />{t("该复盘了：", "Time to review: ", "Hora de revisar: ")}{item.title}</button>)}
    {groups.filter((group) => group.key !== "past").map((group) => <section key={group.key}><h2 className="space-subhead">{group.title}</h2>{group.items.map((item) => card(item, group.key))}</section>)}
    {past && <details className="agreements-past"><summary>{past.title} · {past.items.length}</summary>{past.items.map((item) => card(item, "past"))}</details>}
  </div>;
}
