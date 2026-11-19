// Hard completion checks are independent of the language judges and never run against a real account.
const local = (date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));
export function recordChecks(item, records, { userId, partnerId, personId, peer, spaceItems = [], now = Date.now() }) {
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  const text = JSON.stringify(records);
  add("请求内容写入", records.length > 0 && (!item.check.pattern || new RegExp(item.check.pattern, "i").test(text)));
  if (["reminder", "checkin", "memory"].includes(item.check.kind)) add("记录属于本人且为私密", records.length > 0 && records.every((record) => record.ownerUserId === userId && record.visibility === "private"));
  if (item.check.kind === "reminder") {
    const times = { "tool-reminder-once": "08:00", "tool-reminder-weekly": "19:00", "plan-recall-then-remind": "20:00", "interaction-voice-reminder": "20:30", "interaction-voice-correction": "16:00" };
    add("恰好一条提醒", records.length === 1);
    const record = records[0], weekly = item.id === "tool-reminder-weekly";
    const today = local(now).slice(0, 10);
    let offset = 1;
    if (weekly) { const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); offset = (5 - weekday + 7) % 7; if (offset === 0 && local(now).slice(11) >= "19:00") offset = 7; }
    const expectedDate = new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    add("日期、时区及时间正确", record?.dueAt && record.timezone === "Asia/Shanghai" && local(record.dueAt) === `${expectedDate} ${times[item.id]}`);
    add("重复周期正确", record?.frequency === (weekly ? "weekly" : "once"));
  }
  if (item.check.kind === "checkin") add("当天心情且包含吵架", records.some((record) => local(record.createdAt).slice(0, 10) === local(now).slice(0, 10) && /吵/.test(JSON.stringify(record))));
  if (item.check.kind === "memory") {
    add("两条事实均保存", /香菜/.test(text) && /花粉/.test(text));
    add("人物主体正确", records.filter((record) => /香菜|花粉/.test(JSON.stringify(record))).every((record) => record.subjectUserId === `person:${personId}` || record.personId === personId));
  }
  if (item.check.kind === "agreement") {
    add("待双方批准而未生效", records.length > 0 && records.every((record) => record.visibility === "shared" && record.status === "awaiting_approvals" && record.approvalPolicy === "both" && !record.effectiveAt));
    add("没有伪造伴侣批准", records.every((record) => !(record.approvedBy || []).includes(partnerId)));
    add("双方看到同一版本", records.every((record) => peer?.agreements?.some((other) => other.id === record.id && other.version === record.version)));
  }
  if (item.check.kind === "space") {
    const requested = records.filter((record) => new RegExp(item.check.pattern).test(record.title || ""));
    add("共同空间双方可见", requested.length > 0 && requested.every((record) => record.visibility === "shared" && peer?.spaces?.some((other) => other.id === record.id)));
    const entries = spaceItems.filter((entry) => requested.some((space) => space.id === entry.spaceId));
    const all = JSON.stringify(entries);
    const expected = item.id === "tool-shared-space-list" ? ["帐篷", "饮用水", "充电宝"] : ["拼图", "番茄"];
    add("所有清单内容已保存", expected.every((word) => all.includes(word)));
    add("清单项双方可见且未伪造完成", entries.length >= expected.length && entries.every((entry) => !entry.done && peer?.spaceItems?.some((other) => other.id === entry.id)));
  }
  return checks;
}
