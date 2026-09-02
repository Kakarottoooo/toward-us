import OpenAI, { toFile } from "openai";

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
      if (!client) return buildFallbackAnalysis(room, "未配置模型服务，已使用本地复盘框架。", model);

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
        return buildFallbackAnalysis(room, "模型暂时不可用，已使用本地复盘框架。", model);
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
            transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-live-transcribe", language: language === "en" ? "en" : "zh" },
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

function mediatorInstructions(language, personality, aName, bName) {
  const tone = {
    friend: "温和、真诚、像一位双方都信任的朋友",
    counselor: "专业、克制、善于把情绪翻译成需要",
    direct: "直接、清晰，但不羞辱任何一方",
  }[personality] || "温和、真诚";
  const outputLanguage = language === "en" ? "English" : "简体中文";
  return `你是情侣与夫妻的第三方调解者。请用${outputLanguage}输出，并保持${tone}的语气。
你的目标是帮助双方降低对抗、理解事实与需要、形成可执行的下一步；绝不宣布谁输谁赢。
你可以明确指出具体行为的责任与伤害，但不要把人贴成好人或坏人。只根据记录判断，不补写事实。
必须分别重述 ${aName} 与 ${bName} 的观点。私人建议可以更直接，但共同结论不得引用只有一方私下提供、另一方无法核验的秘密证据。
若出现辱骂、人身攻击、威胁、控制、暴力或自伤风险，明确提升 safety.level：0 无风险，1 语气升级，2 边界受损，3 应立即停止调解并优先寻求现实安全支持。
允许结论是部分共识、保留分歧、稍后复盘。下一步最多 3 条，具体且能在 24 小时内开始。`;
}

function transcriptForModel(room, a, b) {
  const names = new Map([[a.id, a.name], [b.id, b.name]]);
  const lines = room.messages.map((message, index) => `[${index + 1}] ${names.get(message.participantId) || "未知"}: ${message.text}`);
  return `房间模式：${room.mode === "shared" ? "同一台设备、同一个麦克风" : "两台设备"}\n调解人格：${room.personality}\n对话记录：\n${lines.join("\n")}`;
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
    notice: "AI 结论是辅助视角，不替代专业心理、医疗或法律意见。",
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
  const category = inferCategory(room.messages.map((message) => message.text).join(" "));
  const latestA = [...room.messages].reverse().find((message) => message.participantId === a.id)?.text || "还没有充分表达自己的看法。";
  const latestB = [...room.messages].reverse().find((message) => message.participantId === b.id)?.text || "还没有充分表达自己的看法。";
  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: "local-fallback",
    model,
    notice,
    shared: {
      title: "先把立场放到同一张桌面上",
      overview: "目前更像是双方都在保护自己的需要，但表达方式让彼此先听见了压力，而不是需要。这个结论可以保留分歧，不要求立刻达成一致。",
      category,
      perspectives: [
        { participantId: a.id, name: a.name, view: `你目前强调的是：“${truncate(latestA)}”` },
        { participantId: b.id, name: b.name, view: `你目前强调的是：“${truncate(latestB)}”` },
      ],
      responsibility: [{ side: "both", behavior: "需要把事实、感受和要求分开表达", assessment: "当前记录不足以判断单方责任，但双方都能先调整表达方式。" }],
      commonGround: ["你们愿意把这件事带到同一个空间里处理", "你们都希望自己的感受被认真对待"],
      differences: ["对事件含义和优先级的理解仍然不同"],
      nextSteps: ["每人用一句话说清事实，不评价对方动机", "轮流补完：我感到……因为我需要……", "只选一个今天能做到的小动作，不要求解决全部问题"],
    },
    private: {
      [a.id]: privateFallback(a.name),
      [b.id]: privateFallback(b.name),
    },
    safety: room.safety || { level: 0, message: "未检测到需要立即中止调解的安全信号。" },
  };
}

function privateFallback(name) {
  return {
    validation: `${name}，你的感受值得被认真看见。`,
    reflection: "试着区分：你最想证明的是什么，和你最希望对方理解的是什么。它们可能不是同一件事。",
    suggestion: "共同反馈前，先把一句指责改写成一个具体请求。",
  };
}

function followUpFallback(room, question) {
  const language = room.language === "en";
  return language
    ? `For “${truncate(question, 90)}”, choose one concrete request, let each person answer once without interruption, and agree on when to revisit anything still unresolved.`
    : `针对“${truncate(question, 90)}”，先把它改成一个具体请求；双方各完整回答一次，再约定仍未解决的部分什么时候继续谈。`;
}

function inferCategory(text) {
  const normalized = text.toLowerCase();
  if (/结婚|婚礼|孩子|买房|未来|marriage|wedding|future/.test(normalized)) return "未来与承诺";
  if (/钱|花费|收入|预算|money|budget/.test(normalized)) return "金钱与分配";
  if (/信任|隐瞒|骗|手机|trust|lie/.test(normalized)) return "信任与透明";
  if (/父母|家人|朋友|边界|隐私|boundary|privacy/.test(normalized)) return "边界与关系网络";
  if (/家务|迟到|计划|chores|late|schedule/.test(normalized)) return "日常协作";
  return "沟通与情绪需要";
}

function normalizedParticipants(room) {
  const participants = [...room.participants];
  while (participants.length < 2) {
    participants.push({ id: `pending-${participants.length}`, name: room.language === "en" ? "Partner" : "TA" });
  }
  return participants.slice(0, 2);
}

function truncate(text, limit = 72) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
