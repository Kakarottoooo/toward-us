import { useEffect, useState } from "react";
import { CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import type { GraphRecord, RelationshipHomePayload } from "../relationship/types";
import { relationshipApi } from "../relationship/api";
import { PromiseList } from "../promises/PromiseList";
import { PlanTerms } from "./PendingAgreement";
import "./agreements.css";

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

/** 我们说好的 (founder 11-06): the top of Coming up, not a page of its own. Coming up is for the whole relationship, not next
 * week (founder 11-06), so only what lasts is here: what they promised each other, reviews that are due, agreements in effect
 * with their undated parts, and earlier ones folded away. One waiting for both of them is settled on its card in Us. */
export function AgreementsPage({ language, userId, payload, onChanged, onReview }: { language: Language; userId: string; payload: RelationshipHomePayload; onChanged: () => void | Promise<void>; onReview: (outcomeId: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  // What this member last told Pinky about each of their promises; only they see it.
  const [answers, setAnswers] = useState<Record<string, { done: boolean; at: string }>>({});
  useEffect(() => { relationshipApi<{ promises: Record<string, { done: boolean; at: string }> }>("/api/assistant/promises").then((result) => setAnswers(result.promises)).catch(() => {}); }, []);
  const { agreements, commitments } = payload.graph;
  const groups = [
    { key: "active", title: t("我们说好的", "What we agreed", "Lo que acordamos"), items: agreements.filter((item) => item.status === "active") },
    { key: "past", title: t("以前的", "Earlier", "Anteriores"), items: agreements.filter((item) => !["awaiting_approvals", "active", "draft", "archived"].includes(item.status)) },
  ].filter((group) => group.items.length);
  const reviews = payload.home.pending.filter((item) => item.type === "outcome_review");
  const partnerName = payload.relationship.members.find((member) => member.id !== userId)?.name || t("TA", "Your partner", "Tu pareja");
  const status = (agreement: GraphRecord) => agreement.status === "active" ? t("你们俩都同意了", "You both agreed", "Los dos están de acuerdo") : agreement.status === "renegotiation_requested" ? t("有人想重新商量", "Someone asked to revisit it", "Alguien pidió revisarlo") : t("已结束", "Closed", "Cerrado");
  const nameOf = (id: unknown) => id === userId ? t("你", "you", "tú") : payload.relationship.members.find((member) => member.id === id)?.name || "";
  const card = (agreement: GraphRecord, key: string) => {
    // Parts with a day are on the calendar below; only the undated ones (habits, rules) are listed as commitments here, unless one
    // says word for word what a term already says.
    const terms = strings(agreement.terms), mine = commitments.filter((item) => item.agreementId === agreement.id && !item.archivedAt && !item.dueAt && !terms.includes(String(item.description || "")));
    const when = new Date(agreement.updatedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" }), by = nameOf(agreement.proposedBy);
    return <article key={agreement.id} className={`agreement-item is-${key}`} data-testid="agreement-item">
      <header><strong>{String(agreement.title || "")}</strong><small>{by ? t(`${by}提的 · ${when}`, `From ${by} · ${when}`, `De ${by} · ${when}`) : when}</small></header>
      {!!agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title && <p>{String(agreement.summary)}</p>}
      <PlanTerms terms={terms} language={language} />
      {!!mine.length && <ul className="agreement-commitments">{mine.map((item) => <li key={item.id}>{String(item.description || "")}{answers[item.id] && <small className={`agreement-answer ${answers[item.id].done ? "done" : ""}`}>{answers[item.id].done ? t("你说做到了", "You said you did it", "Dijiste que lo cumpliste") : t("你说还没做到", "You said not yet", "Dijiste que aún no")} · {new Date(answers[item.id].at).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })} · {t("只有你看得到", "only you see this", "solo tú lo ves")}</small>}</li>)}</ul>}
      <footer><span className="card-state">{agreement.status === "active" && <CheckCircle size={16} weight="fill" />}{status(agreement)}</span></footer>
    </article>;
  };
  const past = groups.find((group) => group.key === "past");
  return <div className="agreements-page" data-testid="agreements">
    {/* What the two of them promised each other in conversation comes first: it is what Pinky follows up on (11-03). */}
    <PromiseList language={language} partnerName={partnerName} refreshKey={payload} onChanged={onChanged} hideEmpty />
    {reviews.map((item) => <button key={item.id} className="agreement-review" onClick={() => onReview(item.id)}><ClockCounterClockwise size={20} />{t("该复盘了：", "Time to review: ", "Hora de revisar: ")}{item.title}</button>)}
    {groups.filter((group) => group.key !== "past").map((group) => <section key={group.key}><h2 className="space-subhead">{group.title}</h2>{group.items.map((item) => card(item, group.key))}</section>)}
    {past && <details className="agreements-past"><summary>{past.title} · {past.items.length}</summary>{past.items.map((item) => card(item, "past"))}</details>}
  </div>;
}
