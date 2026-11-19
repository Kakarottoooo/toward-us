import express from "express";
import { asAiUser } from "./ai-budget.mjs";
import { requireAiPermission } from "./ai-permission.mjs";
import { feedbackError, limitFeedbackUploads } from "./feedback-images.mjs";
import { consumeFeedbackQuota } from "./feedback-lifecycle.mjs";

const maxBytes = 44 + 120 * 16_000 * 2;
const readVoice = express.raw({ type: "multipart/form-data", inflate: false, limit: maxBytes + 8192 });
const invalid = () => feedbackError(400, "invalid_feedback_voice");

// Accept only the recorder's fixed mono PCM16 WAV. The exact byte count enforces two minutes,
// and disallowing additional chunks keeps arbitrary metadata out of the provider request.
function validateWave(bytes) {
  if (bytes.length <= 44 || bytes.length % 2 || bytes.toString("latin1", 0, 4) !== "RIFF" ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString("latin1", 8, 16) !== "WAVEfmt " ||
      bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 16_000 || bytes.readUInt32LE(28) !== 32_000 ||
      bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.toString("latin1", 36, 40) !== "data" || bytes.readUInt32LE(40) !== bytes.length - 44) throw invalid();
}

async function voiceParts(req, owner) {
  if (!req.is("multipart/form-data") || !Buffer.isBuffer(req.body)) throw feedbackError(415, "feedback_voice_multipart_required");
  let form;
  try {
    form = await new Response(req.body, { headers: { "content-type": req.get("content-type") } }).formData();
  } catch { throw invalid(); }
  finally { req.body.fill(0); req.body = undefined; }
  const language = form.get("language"), clip = form.get("audio");
  if ([...form.keys()].length !== 3 || !["zh", "en", "es"].includes(language) ||
      typeof form.get("owner_ref") !== "string" || !(clip instanceof Blob) || clip.type !== "audio/wav") throw invalid();
  if (form.get("owner_ref") !== owner) throw feedbackError(409, "feedback_account_changed");
  if (clip.size > maxBytes) throw feedbackError(413, "feedback_voice_too_long");
  const bytes = Buffer.from(await clip.arrayBuffer());
  validateWave(bytes);
  return { bytes, language };
}

export function feedbackVoiceRoute(router, { store, mediator, now }) {
  router.post("/feedback/voice", limitFeedbackUploads, readVoice, async (req, res) => {
    const userId = req.auth.user.id;
    let clip;
    try {
      clip = await voiceParts(req, userId);
      await requireAiPermission(store, userId, clip.language).catch((error) => {
        if (error.code === "ai_consent_required") throw feedbackError(403, error.code);
        throw error;
      });
      if (!mediator?.transcribe) throw feedbackError(503, "feedback_voice_unavailable");
      await store.transaction(`user:${userId}`, async (tx) => {
        const owner = await tx.getUserForUpdate(userId);
        if (!owner || owner.passwordHash === "deleted") throw feedbackError(401, "sign_in_required");
        await consumeFeedbackQuota(tx, userId, now, { voice: true });
      });
      let result;
      try {
        // Preserve mixed-language speech: the existing file transcriber does not force a single spoken language.
        result = await asAiUser({ userId, language: clip.language }, () =>
          mediator.transcribe(clip.bytes, "audio/wav", clip.language, "feedback_voice"));
      } catch (error) {
        // Provider errors can contain private request details. Send only known, content-free codes.
        if (["ai_content_blocked", "ai_screening_unavailable", "ai_consent_required", "ai_daily_limit"].includes(error?.code)) {
          throw feedbackError(error.statusCode, error.code);
        }
        throw feedbackError(503, "feedback_voice_unavailable");
      }
      const text = result?.text?.trim();
      if (!text) throw feedbackError(422, "feedback_voice_empty");
      res.json({ text });
    } finally {
      clip?.bytes.fill(0);
      res.locals.releaseFeedbackUpload?.();
    }
  });
}
