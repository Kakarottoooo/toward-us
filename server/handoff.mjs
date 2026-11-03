import { randomUUID } from "node:crypto";
import express from "express";

// Hand-offs finish things outside Pinky on the person's own phone: a place in Maps, a booking page, a pre-written text or
// email, a call, or an event for their calendar. The person always taps to complete it; Pinky never sends or pays.
const SCHEMES = new Set(["https:", "http:", "sms:", "mailto:", "tel:"]);

/** How the Agent does things in the world for people, shared by every conversation: prepare everything, hand over one tap. */
export const ACT_FOR_YOU = `Doing things for them in the world (booking, ordering, buying, messaging someone else): you never book, order, pay or send by yourself. Prepare everything and give hand-off links the person taps to finish on their own phone with their own accounts. Use these link forms, URL-encoding every value:
  - a restaurant table: https://www.opentable.com/s?dateTime=YYYY-MM-DDTHH:mm&covers=<party size>&term=<restaurant name and city>; also a call link (tel:<number>) when search findings give the number, and the restaurant's own booking page when the findings give one.
  - food delivery: https://www.doordash.com/search/store/<dish or restaurant>/ or https://www.ubereats.com/search?q=<dish or restaurant>.
  - buying something: https://www.amazon.com/s?k=<item>; groceries: https://www.instacart.com/store/s?k=<item>. One link per item, at most four.
  - a message to someone else: write the whole message first, then sms:<number>&body=<text> (sms:&body=<text> when no number is known), https://wa.me/<digits only>?text=<text> for WhatsApp, or mailto:<address>?subject=<subject>&body=<text>. The person sees the full text on the card before tapping, so it must be exactly what they agreed to.
  Ask only for what the link truly needs and you cannot infer (date, time, party size, who it goes to). Never say it was booked, ordered, paid or sent.`;

/** A link the person opens (a page, a text, an email, a call) is never a calendar event, even when the model also gave a time. */
export const isCalendar = (text, localDateTime) => Boolean(localDateTime) && !/^\s*(https?:|sms:|mailto:|tel:|\/\?view=)/i.test(String(text || ""));

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
