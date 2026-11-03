import { randomUUID } from "node:crypto";
import express from "express";

// Hand-offs finish things outside Pinky on the person's own phone: a place in Maps, a booking page, a pre-written text or
// email, a call, or an event for their calendar. The person always taps to complete it; Pinky never sends or pays.
const SCHEMES = new Set(["https:", "http:", "sms:", "mailto:", "tel:"]);

/** A safe hand-off URL from the model, or null. Calendar events become a link to the stateless .ics endpoint. */
export function handoffUrl({ url, localDateTime, title, location = "", timezone = "UTC" }) {
  if (localDateTime) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime) || !title) return null;
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = "UTC"; }
    return `/api/handoff/event.ics?${new URLSearchParams({ title: title.slice(0, 120), start: localDateTime, tz: timezone, ...(location ? { location: location.slice(0, 200) } : {}) })}`;
  }
  if (typeof url !== "string" || url.length > 1000) return null;
  // A page inside Pinky itself (for example the chat-history import page); the app opens it in place.
  if (/^\/\?view=[a-z]+(&[a-z]+=[A-Za-z0-9-]+)*$/.test(url.trim())) return url.trim();
  try { const parsed = new URL(url.trim()); return SCHEMES.has(parsed.protocol) ? parsed.href : null; } catch { return null; }
}

const icsText = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (match) => `\\${match}`).replace(/\r?\n/g, "\\n").slice(0, 300);

export function createHandoffRouter() {
  const router = express.Router();
  // Stateless: it only formats the given words into an event file and reads no stored data.
  router.get("/handoff/event.ics", (req, res) => {
    const start = String(req.query.start || ""), title = String(req.query.title || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || !title) return res.status(400).json({ error: "An event needs a title and a start time." });
    let tz = String(req.query.tz || "UTC"); try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "UTC"; }
    const [date, time] = start.split("T"); const begin = `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
    const endDate = new Date(`${start}:00Z`); endDate.setUTCHours(endDate.getUTCHours() + 1);
    const end = endDate.toISOString().slice(0, 16).replace(/[-:]/g, "") + "00";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pinky//EN", "BEGIN:VEVENT", `UID:${randomUUID()}@pinky`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;TZID=${tz}:${begin}`, `DTEND;TZID=${tz}:${end}`, `SUMMARY:${icsText(title)}`, ...(req.query.location ? [`LOCATION:${icsText(req.query.location)}`] : []), "END:VEVENT", "END:VCALENDAR"];
    res.set({ "content-type": "text/calendar; charset=utf-8", "content-disposition": "inline; filename=pinky-event.ics", "cache-control": "no-store" }).send(lines.join("\r\n"));
  });
  return router;
}
