import { appendTogetherMessage } from "./together-domain.mjs";
import { MOMENTS } from "./space-domain.mjs";
import { markShowedUp } from "./streak.mjs";

// 一起养的小家伙 (founder 11-06): the couple's character grows with what the two of them do together. Nothing new to learn: it
// earns 亲密值 from things they already do (both answering the daily question, a game round, 想你了, a memory kept together, a
// letter opened, an agreement made) plus one 摸摸它 each per day, with a bonus when both do it the same day. Points are
// counted once per event (kept as keys on the shared conversation), so they never drop when old messages are archived.
// Levels are announced in Us once; if nobody comes by for a few days it gets sleepy.
export const PET_POINTS = { daily: 10, game: 5, nudge: 2, letter: 20, moment: 3, agreement: 10, pet: 1, both: 3 };
const DAILY_CAPS = { nudge: 3, moment: 3 };
const KEEP_DAYS = 365;
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const dayOf = (iso, zone) => { try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: zone || "UTC" }); } catch { return String(iso).slice(0, 10); } };
const between = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
/** Level from 亲密值: Lv.2 at 50, Lv.3 at 150, Lv.4 at 300, Lv.5 at 500… */
export const levelFor = (points) => { let level = 1; while (25 * level * (level + 1) <= points) level += 1; return level; };
const floorOf = (level) => level <= 1 ? 0 : 25 * (level - 1) * level;

/** Everything the couple did together that counts, as { key, type, day } — one per event. */
function events(snapshot, relationshipId, conversation, zone) {
  const found = [];
  for (const message of conversation?.messages || []) {
    const day = dayOf(message.createdAt, zone);
    if (message.kind === "daily_question" && Object.keys(message.answers || {}).length >= 2) found.push({ key: `daily:${message.id}`, type: "daily", day });
    if (message.kind === "game" && Object.keys(message.answers || {}).length >= 2) found.push({ key: `game:${message.id}`, type: "game", day });
    if (message.kind === "nudge") found.push({ key: `nudge:${message.id}`, type: "nudge", day });
    if (message.kind === "letter") found.push({ key: `letter:${message.id}`, type: "letter", day });
  }
  const shared = (item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt;
  const album = (snapshot.spaces || []).find((space) => shared(space) && space.system === MOMENTS);
  for (const item of (snapshot.spaceItems || []).filter((entry) => album && shared(entry) && entry.spaceId === album.id)) found.push({ key: `moment:${item.id}`, type: "moment", day: dayOf(item.createdAt, zone) });
  for (const agreement of (snapshot.agreements || []).filter((entry) => shared(entry) && entry.status === "active")) found.push({ key: `agreement:${agreement.id}`, type: "agreement", day: dayOf(agreement.updatedAt || agreement.createdAt, zone) });
  for (const [day, members] of Object.entries(conversation?.pets || {})) {
    for (const id of members) found.push({ key: `pet:${day}:${id}`, type: "pet", day });
    if (members.length >= 2) found.push({ key: `both:${day}`, type: "both", day });
  }
  return found;
}

/** Adds what is new to the pet kept on the conversation (inside the caller's lock). Returns the updated pet and whether it
 * reached a new level. */
export function grow(pet, found, today) {
  const next = { points: pet?.points || 0, seen: { ...(pet?.seen || {}) }, announced: pet?.announced || 1, gains: [...(pet?.gains || [])] };
  const perDay = {};
  for (const [key, entry] of Object.entries(next.seen)) { const type = key.split(":")[0]; perDay[`${type}:${entry.day}`] = (perDay[`${type}:${entry.day}`] || 0) + 1; }
  for (const event of found.sort((a, b) => a.day.localeCompare(b.day))) {
    if (next.seen[event.key]) continue;
    const slot = `${event.type}:${event.day}`;
    const capped = DAILY_CAPS[event.type] && (perDay[slot] || 0) >= DAILY_CAPS[event.type];
    const points = capped ? 0 : PET_POINTS[event.type];
    next.seen[event.key] = { day: event.day, points };
    perDay[slot] = (perDay[slot] || 0) + 1;
    if (points) { next.points += points; next.gains = [...next.gains, { type: event.type, points, day: event.day }].slice(-8); }
  }
  // Keys older than a year are dropped; anything that old is no longer in the working set to be counted again.
  for (const [key, entry] of Object.entries(next.seen)) if (between(entry.day, today) > KEEP_DAYS) delete next.seen[key];
  const level = levelFor(next.points), leveled = level > next.announced;
  if (leveled) next.announced = level;
  return { pet: next, leveled: leveled ? level : null };
}

/** What a member sees: level, progress, mood, who petted it today. */
export function petView(pet, conversation, userId, today) {
  const level = levelFor(pet?.points || 0);
  const days = [...Object.values(pet?.seen || {}).map((entry) => entry.day), ...(conversation?.messages || []).filter((message) => message.role === "member").map((message) => String(message.createdAt).slice(0, 10))].filter(Boolean).sort();
  const last = days.at(-1);
  const quiet = last ? between(last, today) : 99;
  const petted = conversation?.pets?.[today] || [];
  return { points: pet?.points || 0, level, floor: floorOf(level), next: floorOf(level + 1), mood: quiet <= 1 ? "happy" : quiet <= 3 ? "calm" : "sleepy", pettedByMe: petted.includes(userId), pettedByPartner: petted.some((id) => id !== userId), gains: (pet?.gains || []).slice(-6).reverse() };
}

/** Brings the couple's pet up to date (and announces a new level in Us once). Call inside the relationship lock. */
export async function syncPet(tx, { relationshipId, userId, zone, language = "zh" }) {
  const id = `together:${relationshipId}`;
  const conversation = await tx.getRelationshipRecordForUser("togetherConversations", id, userId);
  if (!conversation) return null;
  const snapshot = { spaces: await tx.listRelationshipRecordsForUser("spaces", userId), spaceItems: await tx.listRelationshipRecordsForUser("spaceItems", userId), agreements: await tx.listRelationshipRecordsForUser("agreements", userId) };
  const today = dayOf(new Date().toISOString(), zone);
  const { pet, leveled } = grow(conversation.pet, events(snapshot, relationshipId, conversation, zone), today);
  let current = conversation;
  if (JSON.stringify(pet) !== JSON.stringify(conversation.pet || null)) current = await tx.updateRelationshipRecordForUser("togetherConversations", id, userId, (draft) => { draft.pet = pet; });
  if (leveled) {
    const posted = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: say(language, `🎉 你们的小家伙长到 Lv.${leveled} 了！谢谢你们一直陪着它。`, `🎉 Your little one just reached Lv.${leveled}! Thanks for looking after it together.`, `🎉 ¡Su pequeño llegó al nivel ${leveled}! Gracias por cuidarlo juntos.`), handle: `pet-level:${leveled}` });
    current = posted.conversation;
  }
  return { conversation: current, view: petView(pet, current, userId, today), leveled };
}

/** 摸摸它: once a day each; both on the same day earns a bonus. */
export async function petIt(tx, { relationshipId, userId, zone, language }) {
  const id = `together:${relationshipId}`;
  const today = dayOf(new Date().toISOString(), zone);
  await tx.updateRelationshipRecordForUser("togetherConversations", id, userId, (draft) => {
    const pets = { ...(draft.pets || {}) };
    if (!(pets[today] || []).includes(userId)) pets[today] = [...(pets[today] || []), userId];
    // Only recent days are kept; older ones are already counted in the pet's points.
    for (const day of Object.keys(pets)) if (between(day, today) > 30) delete pets[day];
    draft.pets = pets;
  });
  await markShowedUp(tx, { relationshipId, userId, zone });
  return syncPet(tx, { relationshipId, userId, zone, language });
}
