import OpenAI, { toFile } from "openai";
import { localDecisionOptions } from "./relationship-domain.mjs";

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "overview", "category", "perspectiveA", "perspectiveB", "responsibility", "commonGround", "differences", "nextSteps", "privateA", "privateB", "safety"],
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    category: { type: "string" },
    perspectiveA: { type: "string" },
    perspectiveB: { type: "string" },
    responsibility: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["side", "behavior", "assessment"],
        properties: {
          side: { type: "string", enum: ["A", "B", "both", "unclear"] },
          behavior: { type: "string" },
          assessment: { type: "string" },
        },
      },
    },
    commonGround: { type: "array", items: { type: "string" } },
    differences: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    privateA: { $ref: "#/$defs/privateFeedback" },
    privateB: { $ref: "#/$defs/privateFeedback" },
    safety: {
      type: "object",
      additionalProperties: false,
      required: ["level", "message"],
      properties: {
        level: { type: "integer", minimum: 0, maximum: 3 },
        message: { type: "string" },
      },
    },
  },
  $defs: {
    privateFeedback: {
      type: "object",
      additionalProperties: false,
      required: ["validation", "reflection", "suggestion"],
      properties: {
        validation: { type: "string" },
        reflection: { type: "string" },
        suggestion: { type: "string" },
      },
    },
  },
};

export function createMediator({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || "gpt-5.4" } = {}) {
  const client = apiKey ? new OpenAI({ apiKey }) : null;

  return {
    aiReady: Boolean(client),
    model,
    async analyze(room) {
      if (!client) return buildFallbackAnalysis(room, localText(room.language, "未配置模型服务，已使用本地复盘框架。", "Model service is not configured; the local reflection framework was used.", "El servicio del modelo no está configurado; se utilizó el marco de reflexión local."), model);

      try {
        const [a, b] = normalizedParticipants(room);
        const response = await client.responses.create({
          model,
          store: false,
          max_output_tokens: 1800,
          text: {
            format: {
              type: "json_schema",
              name: "relationship_mediation",
              strict: true,
              schema: analysisSchema,
            },
          },
          input: [
            {
              role: "developer",
              content: mediatorInstructions(room.language, room.personality, a.name, b.name),
            },
            {
              role: "user",
              content: transcriptForModel(room, a, b),
            },
          ],
        });

        const parsed = JSON.parse(response.output_text);
        return normalizeModelAnalysis(parsed, room, model);
      } catch (error) {
        console.error("AI mediation failed; using local fallback:", error?.message || error);
        return buildFallbackAnalysis(room, localText(room.language, "模型暂时不可用，已使用本地复盘框架。", "The model is temporarily unavailable; the local reflection framework was used.", "El modelo no está disponible temporalmente; se utilizó el marco de reflexión local."), model);
      }
    },
    async answer(room, question) {
      if (!client) return followUpFallback(room, question);
      try {
        const response = await client.responses.create({
          model,
          store: false,
          max_output_tokens: 700,
          input: [
            { role: "developer", content: `${mediatorInstructions(room.language, room.personality, room.participants[0]?.name || "A", room.participants[1]?.name || "B")}\n这是共同空间里的公开追问。简洁回答当前问题，不重新宣布输赢，不泄露任何一方的私人反馈。只输出适合直接阅读的纯文本，不使用 Markdown 标记；除非检测到真实风险，否则不要输出 safety 等内部字段。` },
            { role: "user", content: `${transcriptForModel(room, ...normalizedParticipants(room))}\n\n已生成的共同分析：${JSON.stringify(room.analysis?.shared || {})}\n\n共同追问记录：${JSON.stringify(room.aiConversation || [])}\n\n当前问题：${question}` },
          ],
        });
        return sanitizeFollowUp(response.output_text) || followUpFallback(room, question);
      } catch (error) {
        console.error("AI follow-up failed; using local fallback:", error?.message || error);
        return followUpFallback(room, question);
      }
    },
    async summarizePerspective(perspective, language = "zh") {
      const fallback = perspective.shareableText || [perspective.goal, perspective.importance, perspective.negotiables].filter(Boolean).join(" ").slice(0, 1200);
      if (!client) return { text: fallback, source: "local" };
      try {
        const response = await client.responses.create({
          model, store: false, max_output_tokens: 350,
          input: [
            { role: "developer", content: `You are a private relationship agent. Write one concise ${language === "zh" ? "Simplified Chinese" : language === "es" ? "Spanish" : "English"} shareable-summary draft. Include only information the user marked shareable. Do not diagnose, pressure, or expose private-only fields. Output plain text.` },
            { role: "user", content: JSON.stringify({ goal: perspective.goal, importance: perspective.importance, negotiables: perspective.negotiables, shareableText: perspective.shareableText }) },
          ],
        });
        return { text: response.output_text.trim() || fallback, source: "openai" };
      } catch (error) {
        console.error("Private perspective summary failed; using local fallback:", error?.message || error);
        return { text: fallback, source: "local" };
      }
    },
    async generateDecisionOptions(context, language = "zh") {
      const fallback = localDecisionOptions(context, language);
      if (!client) return { options: fallback, source: "local" };
      try {
        const response = await client.responses.create({
          model, store: false, max_output_tokens: 1500,
          text: { format: { type: "json_schema", name: "joint_decision_options", strict: true, schema: decisionOptionsSchema } },
          input: [
            { role: "developer", content: `You are the shared agent for two equal principals. Use only the supplied joint context. Produce three options: one closer to each person's confirmed summary and one minimizing the largest loss. Never reveal or infer private information, shame either person, or approve a decision for them. Write in ${language === "zh" ? "Simplified Chinese" : language === "es" ? "Spanish" : "English"}.` },
            { role: "user", content: JSON.stringify(context) },
          ],
        });
        return { options: JSON.parse(response.output_text).options, source: "openai" };
      } catch (error) {
        console.error("Joint decision generation failed; using local fallback:", error?.message || error);
        return { options: fallback, source: "local" };
      }
    },
    async transcribe(buffer, mimeType = "audio/webm") {
      if (!client) {
        const error = new Error("语音转录需要配置 OPENAI_API_KEY。");
        error.statusCode = 503;
        throw error;
      }
      const extension = mimeType.includes("wav") ? "wav"
        : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
          : mimeType.includes("m4a") ? "m4a"
            : mimeType.includes("ogg") ? "ogg"
              : mimeType.includes("mp4") ? "mp4"
                : "webm";
      const file = await toFile(buffer, `conversation.${extension}`, { type: mimeType });
      const result = await client.audio.transcriptions.create({
        file,
        model: "gpt-4o-transcribe-diarize",
        response_format: "diarized_json",
        chunking_strategy: "auto",
      });
      return {
        text: result.text || "",
        duration: result.duration || 0,
        segments: Array.isArray(result.segments) ? result.segments : [],
      };
    },
    async createRealtimeSession({ sdp, language = "zh", safetyIdentifier }) {
      if (!apiKey) {
        const error = new Error("实时语音需要配置 OPENAI_API_KEY。");
        error.statusCode = 503;
        throw error;
      }
      const form = new FormData();
      form.set("sdp", sdp);
      form.set("session", JSON.stringify({
        type: "realtime",
        model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
        output_modalities: ["text"],
        audio: {
          input: {
            noise_reduction: { type: "far_field" },
            transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-live-transcribe", language: language === "es" ? "es" : language === "en" ? "en" : "zh" },
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700, create_response: false, interrupt_response: false },
          },
        },
      }));
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...(safetyIdentifier ? { "OpenAI-Safety-Identifier": safetyIdentifier } : {}) },
        body: form,
      });
      const answer = await response.text();
      if (!response.ok) {
        const error = new Error(`实时语音连接失败（${response.status}）。`);
        error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
        throw error;
      }
      return answer;
    },
  };
}

const decisionOptionsSchema = {
  type: "object", additionalProperties: false, required: ["options"],
  properties: {
    options: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["title", "rationale", "tradeoffs", "conditions", "risks", "disputedFacts"], properties: {
      title: { type: "string" }, rationale: { type: "string" }, tradeoffs: { type: "array", items: { type: "string" } },
      conditions: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } }, disputedFacts: { type: "array", items: { type: "string" } },
    } } },
  },
};

function mediatorInstructions(language, personality, aName, bName) {
  const tone = {
    friend: "温和、真诚、像一位双方都信任的朋友",
    counselor: "专业、克制、善于把情绪翻译成需要",
    direct: "直接、清晰，但不羞辱任何一方",
  }[personality] || "温和、真诚";
  const outputLanguage = language === "es" ? "español" : language === "en" ? "English" : "简体中文";
  return `你是情侣与夫妻的第三方调解者。请用${outputLanguage}输出，并保持${tone}的语气。
你的目标是帮助双方降低对抗、理解事实与需要、形成可执行的下一步；绝不宣布谁输谁赢。
你可以明确指出具体行为的责任与伤害，但不要把人贴成好人或坏人。只根据记录判断，不补写事实。
必须分别重述 ${aName} 与 ${bName} 的观点。私人建议可以更直接，但共同结论不得引用只有一方私下提供、另一方无法核验的秘密证据。
若出现辱骂、人身攻击、威胁、控制、暴力或自伤风险，明确提升 safety.level：0 无风险，1 语气升级，2 边界受损，3 应立即停止调解并优先寻求现实安全支持。
允许结论是部分共识、保留分歧、稍后复盘。下一步最多 3 条，具体且能在 24 小时内开始。`;
}

function transcriptForModel(room, a, b) {
  const names = new Map([[a.id, a.name], [b.id, b.name]]);
  const unknown = localText(room.language, "未知", "Unknown", "Desconocido");
  const lines = room.messages.map((message, index) => `[${index + 1}] ${names.get(message.participantId) || unknown}: ${message.text}`);
  return localText(room.language,
    `房间模式：${room.mode === "shared" ? "同一台设备、同一个麦克风" : "两台设备"}\n调解人格：${room.personality}\n对话记录：\n${lines.join("\n")}`,
    `Room mode: ${room.mode === "shared" ? "one shared device and microphone" : "two devices"}\nMediator style: ${room.personality}\nConversation transcript:\n${lines.join("\n")}`,
    `Modo de sala: ${room.mode === "shared" ? "un dispositivo y micrófono compartidos" : "dos dispositivos"}\nEstilo de mediación: ${room.personality}\nTranscripción de la conversación:\n${lines.join("\n")}`,
  );
}

export function sanitizeFollowUp(value) {
  return String(value || "")
    .replace(/^\s*safety(?:\.level)?\s*[：:]\s*0\s*$/gimu, "")
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/__(.*?)__/gs, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeModelAnalysis(parsed, room, model) {
  const [a, b] = normalizedParticipants(room);
  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: "openai",
    model,
    notice: localText(room.language, "AI 结论是辅助视角，不替代专业心理、医疗或法律意见。", "AI provides an additional perspective and does not replace professional psychological, medical, or legal advice.", "La IA ofrece una perspectiva adicional y no sustituye el asesoramiento psicológico, médico o legal profesional."),
    shared: {
      title: parsed.title,
      overview: parsed.overview,
      category: parsed.category,
      perspectives: [
        { participantId: a.id, name: a.name, view: parsed.perspectiveA },
        { participantId: b.id, name: b.name, view: parsed.perspectiveB },
      ],
      responsibility: parsed.responsibility,
      commonGround: parsed.commonGround,
      differences: parsed.differences,
      nextSteps: parsed.nextSteps,
    },
    private: {
      [a.id]: parsed.privateA,
      [b.id]: parsed.privateB,
    },
    safety: parsed.safety,
  };
}

function buildFallbackAnalysis(room, notice, model) {
  const [a, b] = normalizedParticipants(room);
  const category = inferCategory(room.messages.map((message) => message.text).join(" "), room.language);
  const notExpressed = localText(room.language, "还没有充分表达自己的看法。", "They have not fully expressed their perspective yet.", "Aún no ha expresado plenamente su perspectiva.");
  const latestA = [...room.messages].reverse().find((message) => message.participantId === a.id)?.text || notExpressed;
  const latestB = [...room.messages].reverse().find((message) => message.participantId === b.id)?.text || notExpressed;
  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: "local-fallback",
    model,
    notice,
    shared: {
      title: localText(room.language, "先把立场放到同一张桌面上", "Put both perspectives on the same table", "Pongan ambas perspectivas sobre la misma mesa"),
      overview: localText(room.language, "目前更像是双方都在保护自己的需要，但表达方式让彼此先听见了压力，而不是需要。这个结论可以保留分歧，不要求立刻达成一致。", "Both people seem to be protecting important needs, but the way they are being expressed makes pressure easier to hear than the needs themselves. You can keep the disagreement without forcing immediate agreement.", "Ambas personas parecen estar protegiendo necesidades importantes, pero la forma de expresarlas hace que se perciba antes la presión que la necesidad. Pueden conservar el desacuerdo sin forzar un acuerdo inmediato."),
      category,
      perspectives: [
        { participantId: a.id, name: a.name, view: localText(room.language, `你目前强调的是：“${truncate(latestA)}”`, `What you are emphasizing is: “${truncate(latestA)}”`, `Lo que estás destacando es: «${truncate(latestA)}»`) },
        { participantId: b.id, name: b.name, view: localText(room.language, `你目前强调的是：“${truncate(latestB)}”`, `What you are emphasizing is: “${truncate(latestB)}”`, `Lo que estás destacando es: «${truncate(latestB)}»`) },
      ],
      responsibility: [{ side: "both", behavior: localText(room.language, "需要把事实、感受和要求分开表达", "Separate facts, feelings, and requests", "Separar los hechos, los sentimientos y las peticiones"), assessment: localText(room.language, "当前记录不足以判断单方责任，但双方都能先调整表达方式。", "There is not enough information to assign responsibility to one person, but both can adjust how they express themselves.", "No hay información suficiente para atribuir la responsabilidad a una sola persona, pero ambos pueden ajustar cómo se expresan.") }],
      commonGround: [localText(room.language, "你们愿意把这件事带到同一个空间里处理", "You are both willing to address this in the same space", "Ambos están dispuestos a abordar esto en el mismo espacio"), localText(room.language, "你们都希望自己的感受被认真对待", "You both want your feelings to be taken seriously", "Ambos quieren que sus sentimientos se tomen en serio")],
      differences: [localText(room.language, "对事件含义和优先级的理解仍然不同", "You still understand the meaning and priority of the situation differently", "Siguen entendiendo de manera distinta el significado y la prioridad de la situación")],
      nextSteps: [localText(room.language, "每人用一句话说清事实，不评价对方动机", "Each person states one fact without judging the other's motive", "Cada persona expresa un hecho sin juzgar la intención de la otra"), localText(room.language, "轮流补完：我感到……因为我需要……", "Take turns completing: I feel… because I need…", "Túrnense para completar: Siento… porque necesito…"), localText(room.language, "只选一个今天能做到的小动作，不要求解决全部问题", "Choose one small action you can take today instead of solving everything", "Elijan una pequeña acción que puedan realizar hoy, sin intentar resolverlo todo")],
    },
    private: {
      [a.id]: privateFallback(a.name, room.language),
      [b.id]: privateFallback(b.name, room.language),
    },
    safety: room.safety || { level: 0, message: localText(room.language, "未检测到需要立即中止调解的安全信号。", "No safety signal requiring an immediate stop was detected.", "No se detectó ninguna señal de seguridad que requiera detenerse de inmediato.") },
  };
}

function privateFallback(name, language) {
  return {
    validation: localText(language, `${name}，你的感受值得被认真看见。`, `${name}, your feelings deserve to be taken seriously.`, `${name}, tus sentimientos merecen ser tomados en serio.`),
    reflection: localText(language, "试着区分：你最想证明的是什么，和你最希望对方理解的是什么。它们可能不是同一件事。", "Try to separate what you most want to prove from what you most want your partner to understand. They may not be the same thing.", "Intenta distinguir entre lo que más quieres demostrar y lo que más deseas que tu pareja comprenda. Puede que no sean lo mismo."),
    suggestion: localText(language, "共同反馈前，先把一句指责改写成一个具体请求。", "Before the shared feedback, turn one accusation into a specific request.", "Antes de la reflexión compartida, convierte una acusación en una petición concreta."),
  };
}

function followUpFallback(room, question) {
  return localText(room.language,
    `针对“${truncate(question, 90)}”，先把它改成一个具体请求；双方各完整回答一次，再约定仍未解决的部分什么时候继续谈。`,
    `For “${truncate(question, 90)}”, choose one concrete request, let each person answer once without interruption, and agree on when to revisit anything still unresolved.`,
    `Para «${truncate(question, 90)}», formulen una petición concreta, dejen que cada persona responda una vez sin interrupciones y acuerden cuándo retomarán lo que siga pendiente.`,
  );
}

function inferCategory(text, language = "zh") {
  const normalized = text.toLowerCase();
  if (/结婚|婚礼|孩子|买房|未来|marriage|wedding|future|matrimonio|boda|futuro/.test(normalized)) return localText(language, "未来与承诺", "Future and commitment", "Futuro y compromiso");
  if (/钱|花费|收入|预算|money|budget|dinero|presupuesto/.test(normalized)) return localText(language, "金钱与分配", "Money and allocation", "Dinero y distribución");
  if (/信任|隐瞒|骗|手机|trust|lie|confianza|mentira/.test(normalized)) return localText(language, "信任与透明", "Trust and transparency", "Confianza y transparencia");
  if (/父母|家人|朋友|边界|隐私|boundary|privacy|familia|límites|privacidad/.test(normalized)) return localText(language, "边界与关系网络", "Boundaries and relationships", "Límites y relaciones");
  if (/家务|迟到|计划|chores|late|schedule|tareas|tarde|horario/.test(normalized)) return localText(language, "日常协作", "Everyday coordination", "Coordinación cotidiana");
  return localText(language, "沟通与情绪需要", "Communication and emotional needs", "Comunicación y necesidades emocionales");
}

function normalizedParticipants(room) {
  const participants = [...room.participants];
  while (participants.length < 2) {
    participants.push({ id: `pending-${participants.length}`, name: localText(room.language, "TA", "Partner", "Pareja") });
  }
  return participants.slice(0, 2);
}

function truncate(text, limit = 72) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function localText(language, zh, en, es) {
  return language === "zh" ? zh : language === "es" ? es : en;
}
