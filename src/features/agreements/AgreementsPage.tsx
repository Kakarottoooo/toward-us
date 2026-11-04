import { useEffect, useState } from "react";
import { CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord, RelationshipHomePayload } from "../relationship/types";
import { PromiseList } from "../promises/PromiseList";
import "./agreements.css";

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

/** Every agreement of the couple, readable in full: waiting for approval, in effect, and past. Approving happens right here. */
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
    { key: "active", title: t("生效中", "In effect", "En vigor"), items: agreements.filter((item) => item.status === "active") },
    { key: "past", title: t("以前的", "Earlier", "Anteriores"), items: agreements.filter((item) => !["awaiting_approvals", "active", "draft"].includes(item.status)) },
  ].filter((group) => group.items.length);
  const reviews = payload.home.pending.filter((item) => item.type === "outcome_review");
  const status = (agreement: GraphRecord) => agreement.status === "awaiting_approvals" ? (approvedByMe(agreement) ? t("你已批准，等 TA 批准", "You approved; waiting for your partner", "Ya aprobaste; esperando a tu pareja") : t("等你批准这一版", "Waiting for your approval of this version", "Espera tu aprobación de esta versión")) : agreement.status === "active" ? t("你们俩都批准了", "Both of you approved", "Los dos lo aprobaron") : agreement.status === "renegotiation_requested" ? t("有人想重新商量", "Someone asked to revisit it", "Alguien pidió revisarlo") : t("已结束", "Closed", "Cerrado");
  const partnerName = payload.relationship.members.find((member) => member.id !== userId)?.name || t("TA", "Your partner", "Tu pareja");
  return <div className="agreements-page">
    {notice && <p className="space-error" role="alert">{notice}</p>}
    {/* What the two of them promised each other in conversation comes first: it is what Pinky follows up on (11-03). */}
    <PromiseList language={language} partnerName={partnerName} refreshKey={payload} onChanged={onChanged} />
    {reviews.map((item) => <button key={item.id} className="agreement-review" onClick={() => onReview(item.id)}><ClockCounterClockwise size={20} />{t("该复盘了：", "Time to review: ", "Hora de revisar: ")}{item.title}</button>)}
    {!groups.length && !reviews.length && <p className="space-empty">{t("还没有约定。在“我们俩”里叫 Pinky 帮你们把一件事定下来，两人都批准同一版本后就会出现在这里。", "No agreements yet. Ask Pinky in Us to help you settle something; once you both approve the same version it appears here.", "Aún no hay acuerdos. Pídele a Pinky en Nosotros que les ayude a acordar algo; cuando los dos aprueben la misma versión aparecerá aquí.")}</p>}
    {groups.map((group) => <section key={group.key}><h2 className="space-subhead">{group.title}</h2>
      {group.items.map((agreement) => {
        const terms = strings(agreement.terms), open = strings(agreement.unresolvedPoints), mine = commitments.filter((item) => item.agreementId === agreement.id && !item.archivedAt);
        return <article key={agreement.id} className={`agreement-item is-${group.key}`}>
          <header><strong>{String(agreement.title || "")}</strong><small>{t(`第 ${agreement.version} 版`, `Version ${agreement.version}`, `Versión ${agreement.version}`)} · {new Date(agreement.updatedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })}</small></header>
          {!!agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title && <p>{String(agreement.summary)}</p>}
          {!!terms.length && <ol>{terms.map((term, index) => <li key={index}>{term}</li>)}</ol>}
          {!!open.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{open.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}
          {!!mine.length && <ul className="agreement-commitments">{mine.map((item) => <li key={item.id}>{String(item.description || "")}{item.dueAt ? ` · ${new Date(String(item.dueAt)).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })}` : ""}{answers[item.id] && <small className={`agreement-answer ${answers[item.id].done ? "done" : ""}`}>{answers[item.id].done ? t("你说做到了", "You said you did it", "Dijiste que lo cumpliste") : t("你说还没做到", "You said not yet", "Dijiste que aún no")} · {new Date(answers[item.id].at).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })} · {t("只有你看得到", "only you see this", "solo tú lo ves")}</small>}</li>)}</ul>}
          <footer><span className="card-state">{agreement.status === "active" && <CheckCircle size={16} weight="fill" />}{status(agreement)}</span>
            {agreement.status === "awaiting_approvals" && !approvedByMe(agreement) && <div className="card-actions"><button className="card-primary" disabled={busy === agreement.id} onClick={() => void decide(agreement, "approve")}><CheckCircle size={18} weight="fill" />{t(`批准第 ${agreement.version} 版`, `Approve v${agreement.version}`, `Aprobar v${agreement.version}`)}</button><button disabled={busy === agreement.id} onClick={() => void decide(agreement, "request-change")}>{t("要改", "Request change", "Pedir cambio")}</button></div>}
          </footer>
        </article>;
      })}</section>)}
  </div>;
}
