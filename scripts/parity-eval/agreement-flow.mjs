// Exercises the existing UI's HTTP actions. The model is never granted either person's approval.
export async function agreementFlow({ call, snapshot, me, partner, draft, initialAgreements = [] }) {
  const stages = [], checks = [];
  const add = (name, ok) => checks.push({ stage: stages.at(-1)?.stage, name, ok: Boolean(ok) });
  const view = (record) => record ? { id: record.id, version: record.version, title: record.title, summary: record.summary,
    terms: record.terms, unresolvedPoints: record.unresolvedPoints, status: record.status, approvedBy: record.approvedBy || [], effectiveAt: record.effectiveAt } : null;
  stages.push({ stage: "draft", actor: "提出者", draft });
  add("草稿已保存且未自动批准", Boolean(draft?.title && draft.terms?.length) && initialAgreements.every((record) => !record.effectiveAt && !(record.approvedBy || []).includes(partner.user.id)));
  if (!checks.every((check) => check.ok)) return { stages, checks, completed: false };
  try {
    const sent = (await call("/together/agreements/draft", { language: "zh" }, me.cookie)).result.agreement;
    const peerSent = (await snapshot(partner.user.id)).agreements?.find((record) => record.id === sent.id);
    stages.push({ stage: "submitted", actor: "提出者", agreement: view(sent), partnerView: view(peerSent) });
    add("发送后为待双方批准", sent.status === "awaiting_approvals" && !sent.effectiveAt && !sent.approvedBy?.length);
    add("双方审阅同一版本同一正文", peerSent?.version === sent.version && JSON.stringify(view(peerSent)) === JSON.stringify(view(sent)));
    if (!checks.every((check) => check.ok)) return { stages, checks, completed: false };
    const approve = (cookie) => call(`/together/agreements/${sent.id}/approve`, { version: sent.version, language: "zh" }, cookie);
    const first = (await approve(me.cookie)).result.agreement;
    stages.push({ stage: "first_approved", actor: "提出者", agreement: view(first) });
    add("本人批准不能代替伴侣", first.status === "awaiting_approvals" && !first.effectiveAt && first.approvedBy?.length === 1 && first.approvedBy[0] === me.user.id);
    // Repeating the first person's authenticated action cannot produce the other person's approval.
    await approve(me.cookie);
    const repeated = (await snapshot(me.user.id)).agreements?.find((record) => record.id === sent.id);
    stages.push({ stage: "repeated_first_approval", actor: "提出者", agreement: view(repeated) });
    add("重复本人批准不伪造另一人", repeated?.status === "awaiting_approvals" && !repeated.effectiveAt && repeated.approvedBy?.length === 1 && repeated.approvedBy[0] === me.user.id);
    if (!checks.every((check) => check.ok)) return { stages, checks, completed: false };
    const second = (await approve(partner.cookie)).result.agreement;
    const peerFinal = (await snapshot(partner.user.id)).agreements?.find((record) => record.id === sent.id);
    stages.push({ stage: "both_approved", actor: "伴侣本人独立账号", agreement: view(second), partnerView: view(peerFinal) });
    add("两人各自批准同版本后生效", second.status === "active" && second.effectiveAt && second.version === sent.version && second.approvedBy?.length === 2 && [me.user.id, partner.user.id].every((id) => second.approvedBy.includes(id)) && peerFinal?.status === "active" && peerFinal.version === sent.version);
  } catch (error) { checks.push({ stage: stages.at(-1)?.stage, name: "约定流程完整执行", ok: false, error: error.message }); }
  return { stages, checks, completed: checks.every((check) => check.ok) };
}
