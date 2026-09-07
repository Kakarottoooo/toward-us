import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";

export function createReminderRouter({ service }) {
  const router = express.Router();
  router.post("/internal/reminders/run", async (req, res, next) => {
    const secret = service.internalSecret;
    if (!secret || secret.length < 32) return res.status(503).json({ error: "Reminder scheduler is not configured." });
    const provided = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    if (!timingSafeEqual(digest(provided), digest(`Bearer ${secret}`))) return res.status(401).json({ error: "Unauthorized." });
    try { res.json(await service.runDue()); } catch (error) { next(error); }
  });
  router.use((req, res, next) => req.auth?.user ? next() : res.status(401).json({ error: "Please sign in.", code: "unauthenticated" }));
  const handle = (operation, status = 200) => async (req, res) => {
    try { const result = await operation(req); res.status(status).json(result ?? {}); }
    catch (error) {
      // Never serialize a provider response, endpoint, private payload or exception stack.
      res.status(error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : error.code === "push_not_configured" ? 503 : 500).json({ error: error.statusCode && error.statusCode < 500 ? error.message : "Reminders are temporarily unavailable.", code: error.code || "reminder_unavailable" });
    }
  };
  router.get("/reminder-settings", handle((req) => service.getSettings(req.auth.user.id)));
  router.patch("/reminder-settings", handle((req) => service.updateSettings(req.auth.user.id, req.body)));
  router.post("/push-subscriptions", handle((req) => service.subscribe(req.auth.user.id, req.body), 201));
  router.delete("/push-subscriptions/:id", handle((req) => service.unsubscribe(req.auth.user.id, req.params.id)));
  router.get("/reminders", handle(async (req) => ({ reminders: await service.listReminders(req.auth.user.id) })));
  router.post("/reminders", handle(async (req) => ({ reminder: await service.createReminder(req.auth.user.id, req.body) }), 201));
  router.patch("/reminders/:id", handle(async (req) => ({ reminder: await service.updateReminder(req.auth.user.id, req.params.id, req.body) })));
  router.post("/reminders/:id/retry", handle((req) => service.retryReminder(req.auth.user.id, req.params.id)));
  return router;
}

function digest(value) { return createHash("sha256").update(value).digest(); }
