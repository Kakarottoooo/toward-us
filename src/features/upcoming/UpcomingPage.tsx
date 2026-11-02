import { useEffect, useState } from "react";
import type { Language } from "../../i18n";
import { localized } from "../../i18n";
import { relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import { RemindersPanel } from "../reminders/RemindersPanel";
import { UpcomingYear, type CalendarEntry } from "./UpcomingYear";

type Reminder = { id: string; title?: string; dueAt?: string; status: string; milestoneId?: string; frequency?: string };
const localDay = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA"); };

/** Coming up for one member: the couple's shared dates and deadlines (when paired) with their own reminders, on one calendar. */
export function UpcomingPage({ language, milestones = [], commitments = [], onOpenMilestone, onOpenCommitment, onAsk, onChanged }: { language: Language; milestones?: GraphRecord[]; commitments?: GraphRecord[]; onOpenMilestone?: () => void; onOpenCommitment?: (id: string) => void; onAsk: (text: string) => void; onChanged?: () => Promise<void> }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  useEffect(() => { relationshipApi<{ reminders: Reminder[] }>("/api/reminders").then((result) => setReminders(result.reminders)).catch(() => setReminders([])); }, []);
  const entries: CalendarEntry[] = [
    ...milestones.filter((item) => !item.archivedAt && typeof item.date === "string").map((item) => ({ id: item.id, date: String(item.date), title: String(item.title || ""), kind: item.recurringRule === "yearly" ? "date" as const : "plan" as const, yearly: item.recurringRule === "yearly", onOpen: onOpenMilestone })),
    ...commitments.filter((item) => item.status === "active" && typeof item.dueAt === "string").map((item) => ({ id: item.id, date: localDay(String(item.dueAt)), title: String(item.description || ""), kind: "plan" as const, onOpen: onOpenCommitment ? () => onOpenCommitment(item.id) : undefined })),
    // A shared date's own reminder is already on the calendar as that date.
    ...reminders.filter((item) => item.dueAt && !item.milestoneId && !["paused", "cancelled", "archived"].includes(item.status)).map((item) => ({ id: item.id, date: localDay(item.dueAt!), title: item.title || "", kind: "reminder" as const, private: true, note: item.frequency === "weekly" ? localized(language, "每周", "Weekly", "Semanal") : undefined })),
  ];
  return <div className="feature-stack">
    <UpcomingYear language={language} entries={entries} onAsk={onAsk} />
    <details className="upcoming-manage"><summary>{localized(language, "管理我的提醒和通知", "Manage my reminders and notifications", "Gestionar mis recordatorios y avisos")}</summary><RemindersPanel language={language} onChanged={onChanged} compose={false} /></details>
  </div>;
}
