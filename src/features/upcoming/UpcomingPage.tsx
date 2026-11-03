import { useEffect, useState } from "react";
import { ChatCircleDots, Trash } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { BottomSheet } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import { RemindersPanel } from "../reminders/RemindersPanel";
import { UpcomingYear, type CalendarEntry } from "./UpcomingYear";

type Reminder = { id: string; title?: string; dueAt?: string; status: string; milestoneId?: string; frequency?: string };
const localDay = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA"); };

/** Coming up for one member: the couple's shared dates and deadlines (when paired) with their own reminders, on one calendar.
 * Tapping a shared date shows its details; changes are asked of Pinky, and whoever added a date can delete it. */
export function UpcomingPage({ language, userId = "", milestones = [], reminders: sharedReminders = [], commitments = [], onOpenCommitment, onAsk, onChanged }: { language: Language; userId?: string; milestones?: GraphRecord[]; reminders?: GraphRecord[]; commitments?: GraphRecord[]; onOpenCommitment?: (id: string) => void; onAsk: (text: string) => void; onChanged?: () => Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState<GraphRecord | null>(null);
  const [confirming, setConfirming] = useState(false), [error, setError] = useState("");
  useEffect(() => { relationshipApi<{ reminders: Reminder[] }>("/api/reminders").then((result) => setReminders(result.reminders)).catch(() => setReminders([])); }, []);
  const entries: CalendarEntry[] = [
    ...milestones.filter((item) => !item.archivedAt && typeof item.date === "string").map((item) => ({ id: item.id, date: String(item.date), title: String(item.title || ""), kind: item.recurringRule === "yearly" ? "date" as const : "plan" as const, yearly: item.recurringRule === "yearly", onOpen: () => { setConfirming(false); setError(""); setOpen(item); } })),
    ...commitments.filter((item) => item.status === "active" && typeof item.dueAt === "string").map((item) => ({ id: item.id, date: localDay(String(item.dueAt)), title: String(item.description || ""), kind: "plan" as const, onOpen: onOpenCommitment ? () => onOpenCommitment(item.id) : undefined })),
    // A shared date's own reminder is already on the calendar as that date.
    ...reminders.filter((item) => item.dueAt && !item.milestoneId && !["paused", "cancelled", "archived"].includes(item.status)).map((item) => ({ id: item.id, date: localDay(item.dueAt!), title: item.title || "", kind: "reminder" as const, private: true, note: item.frequency === "weekly" ? t("每周", "Weekly", "Semanal") : undefined })),
  ];
  const remindBefore = open ? sharedReminders.find((item) => item.milestoneId === open.id && !item.archivedAt) : null;
  const remove = async () => {
    if (!open) return;
    if (!confirming) { setConfirming(true); return; }
    try { await relationshipApi(`/api/milestones/${encodeURIComponent(open.id)}`, { method: "DELETE" }); setOpen(null); await onChanged?.(); } catch (caught) { setError((caught as Error).message); }
  };
  const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return <div className="feature-stack">
    <UpcomingYear language={language} entries={entries} onAsk={onAsk} />
    <details className="upcoming-manage"><summary>{t("管理我的提醒和通知", "Manage my reminders and notifications", "Gestionar mis recordatorios y avisos")}</summary><RemindersPanel language={language} onChanged={onChanged} compose={false} /></details>
    <BottomSheet open={Boolean(open)} onOpenChange={(next) => { if (!next) setOpen(null); }} title={String(open?.title || "")} snap={0.5}>
      {open && <div className="upcoming-sheet">
        <dl>
          <dt>{t("日期", "Date", "Fecha")}</dt><dd>{date(String(open.date))}</dd>
          <dt>{t("重复", "Repeats", "Se repite")}</dt><dd>{open.recurringRule === "yearly" ? t("每年", "Every year", "Cada año") : t("只有这一次", "Just once", "Solo una vez")}</dd>
          <dt>{t("提醒", "Reminder", "Aviso")}</dt><dd>{remindBefore ? t("Pinky 会在“我们俩”里提醒你们", "Pinky reminds you both in Us", "Pinky les avisa en Nosotros") : t("没有设提醒", "No reminder", "Sin aviso")}</dd>
        </dl>
        {open.type === "relationship_started" && <p>{t("这是你们在一起的日子，可以在“回忆”最上面修改。", "This is the day you got together; change it at the top of Moments.", "Es el día en que empezaron; cámbialo arriba en Momentos.")}</p>}
        <button type="button" className="upcoming-sheet-ask" onClick={() => { setOpen(null); onAsk(t(`把“${open.title}”改一下：`, `Change "${open.title}": `, `Cambia «${open.title}»: `)); }}><ChatCircleDots size={18} weight="fill" />{t("跟 Pinky 说怎么改", "Tell Pinky what to change", "Dile a Pinky qué cambiar")}</button>
        {open.createdByUserId === userId && open.type !== "relationship_started" && <button type="button" className={`upcoming-sheet-delete ${confirming ? "confirming" : ""}`} onClick={() => void remove()}><Trash size={18} />{confirming ? t("确认删除这个日子", "Delete this date", "Eliminar esta fecha") : t("删除", "Delete", "Eliminar")}</button>}
        {error && <p className="space-error" role="alert">{error}</p>}
      </div>}
    </BottomSheet>
  </div>;
}
