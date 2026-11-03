import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

// Pinky's own Sendblue line. Fully live only when SENDBLUE_API_KEY, SENDBLUE_API_SECRET and SENDBLUE_FROM_NUMBER are all set;
// otherwise nothing touches the network: outbound messages are logged (masked, without text) and, when SENDBLUE_DRYRUN_FILE is
// set, appended there as JSON lines so a local run can be inspected. Env is read at call time.
// Base and endpoint names follow the Sendblue docs and the Onegent integration that ran live; each lives here once, so a docs
// correction is a one-line change.
const API = "https://api.sendblue.com";
const ENDPOINTS = { send: "/api/send-message", sendGroup: "/api/send-group-message", modifyGroup: "/api/modify-group", evaluateService: "/api/evaluate-service" };
const CHUNK = 6000;
const masked = (phone) => String(phone || "").length > 6 ? `${String(phone).slice(0, 2)}•••${String(phone).slice(-4)}` : "•••";

export function createSendblue({ env = process.env, fetchImpl = (...args) => globalThis.fetch(...args), log = console } = {}) {
  const live = () => Boolean(env.SENDBLUE_API_KEY && env.SENDBLUE_API_SECRET && env.SENDBLUE_FROM_NUMBER);
  const groupsEnabled = () => env.SENDBLUE_GROUPS_ENABLED === "true";
  async function call(method, path, { body = null, query = null } = {}) {
    const response = await fetchImpl(`${API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`, {
      method, signal: AbortSignal.timeout(30_000),
      // Sendblue's Cloudflare rejected a bare runtime user agent in the Onegent live run.
      headers: { "sb-api-key-id": env.SENDBLUE_API_KEY, "sb-api-secret-key": env.SENDBLUE_API_SECRET, Accept: "application/json", "User-Agent": "Pinky/1.0", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Object.assign(new Error(`sendblue_http_${response.status}`), { code: `sendblue_http_${response.status}`, statusCode: response.status }); // statusCode: callers treat 4xx (except 408/429) as permanent
    return response.json().catch(() => ({}));
  }
  async function dryRun(entry) {
    log.log(`sendblue dry-run: ${entry.kind} to ${entry.to ? masked(entry.to) : entry.groupId} (${String(entry.text || "").length} chars)`);
    if (env.SENDBLUE_DRYRUN_FILE) await appendFile(env.SENDBLUE_DRYRUN_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  }
  const chunks = (text) => { const body = String(text || "").trim() || "…"; return Array.from({ length: Math.ceil(body.length / CHUNK) }, (_, index) => body.slice(index * CHUNK, (index + 1) * CHUNK)); };

  return {
    live, groupsEnabled,
    async send(phone, text) {
      if (!live()) return dryRun({ kind: "send", to: phone, text });
      for (const content of chunks(text)) await call("POST", ENDPOINTS.send, { body: { number: phone, from_number: env.SENDBLUE_FROM_NUMBER, content } });
    },
    // A new group needs `numbers`; an existing one is addressed by `groupId`. Inert unless SENDBLUE_GROUPS_ENABLED=true.
    async sendGroup({ groupId = null, numbers = [] }, text) {
      if (!groupsEnabled()) { log.log("sendblue: group messaging is disabled (SENDBLUE_GROUPS_ENABLED is not true)"); return { groupId: null }; }
      if (!live()) { const id = groupId || `dryrun-group-${randomUUID()}`; await dryRun({ kind: "group", groupId: id, numbers, text }); return { groupId: id }; }
      let id = groupId;
      for (const content of chunks(text)) {
        const result = await call("POST", ENDPOINTS.sendGroup, { body: { ...(id ? { group_id: id } : { numbers }), from_number: env.SENDBLUE_FROM_NUMBER, content } });
        id = result?.group_id || id;
      }
      return { groupId: id };
    },
    // Sendblue can add a group member but not remove one.
    async addGroupMember(groupId, phone) {
      if (!groupsEnabled()) { log.log("sendblue: group messaging is disabled (SENDBLUE_GROUPS_ENABLED is not true)"); return false; }
      if (!live()) { await dryRun({ kind: "group_add", groupId, to: phone }); return true; }
      await call("POST", ENDPOINTS.modifyGroup, { body: { group_id: groupId, modify_type: "add_recipient", number: phone } });
      return true;
    },
    // Without credentials a local run treats every number as iMessage, except those listed in SENDBLUE_DRYRUN_NON_IMESSAGE
    // (comma-separated), so a mixed couple can be simulated. Nothing is sent either way.
    async isIMessage(phone) {
      if (!live()) {
        const answer = !String(env.SENDBLUE_DRYRUN_NON_IMESSAGE || "").split(",").map((item) => item.trim()).includes(phone);
        log.log(`sendblue dry-run: service lookup for ${masked(phone)} answered ${answer}`); return answer;
      }
      return (await call("GET", ENDPOINTS.evaluateService, { query: { number: phone } }))?.service === "iMessage";
    },
  };
}

export const sendblue = createSendblue();
