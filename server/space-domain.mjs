import { canViewRecord, createRelationshipRecord, projectRecord } from "./relationship-domain.mjs";

// Spaces are the general container Pinky builds for each couple (a trip plan, a gratitude journal, a renovation list…).
// The model chooses the title and how it is shown; the server only enforces who can see and change it.
export const SPACE_LAYOUTS = Object.freeze(["list", "checklist", "timeline", "gallery", "notes"]);
const SPACE_LIMIT = 60, ITEM_LIMIT = 500;
const clean = (value, limit) => typeof value === "string" ? value.trim().replace(/\0/g, "").slice(0, limit) : "";
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Private spaces belong to one person and never carry a relationship id; shared spaces belong to the active couple. */
export async function createSpace(tx, { userId, relationshipId = null, shared = false, title, layout, description = "", source = "agent" }) {
  const name = clean(title, 80); if (!name) throw fail(400, "A space needs a title.");
  if (shared && !relationshipId) throw fail(409, "Shared spaces need an active partner.");
  const existing = (await tx.listRelationshipRecordsForUser("spaces", userId)).filter((space) => canViewRecord(space, userId));
  if (existing.length >= SPACE_LIMIT) throw fail(409, "Space limit reached. Archive one first.");
  const record = createRelationshipRecord({
    relationshipId: shared ? relationshipId : null, userId, visibility: shared ? "shared" : "private", aiAccessScope: shared ? "joint" : "private",
    title: name, layout: SPACE_LAYOUTS.includes(layout) ? layout : "list", description: clean(description, 400), provenanceSource: source,
  });
  await tx.createRelationshipRecord("spaces", record);
  return record;
}

export async function visibleSpace(tx, id, userId) {
  const space = await tx.getRelationshipRecordForUser("spaces", clean(id, 80), userId);
  if (!space || !canViewRecord(space, userId)) throw fail(404, "Space not found.");
  return space;
}

/** An item inherits who can see it from its space, so nothing private can land in a shared space by accident. */
export async function addSpaceItem(tx, { userId, space, title = "", text = "", date = null, done = false, photoId = null, source = "agent" }) {
  const name = clean(title, 160), body = clean(text, 2000);
  if (!name && !body && !photoId) throw fail(400, "Say what to add.");
  const items = (await tx.listRelationshipRecordsForUser("spaceItems", userId)).filter((item) => item.spaceId === space.id && canViewRecord(item, userId));
  if (items.length >= ITEM_LIMIT) throw fail(409, "This space is full.");
  const record = createRelationshipRecord({
    relationshipId: space.relationshipId, userId, visibility: space.visibility, aiAccessScope: space.aiAccessScope,
    spaceId: space.id, title: name, text: body, date: date && isDate(date) ? date : null, done: Boolean(done), photoId: photoId ? clean(photoId, 80) : null, provenanceSource: source,
  });
  await tx.createRelationshipRecord("spaceItems", record);
  await tx.updateRelationshipRecordForUser("spaces", space.id, userId, (draft) => { draft.version += 1; });
  return record;
}

export async function updateSpaceItem(tx, { userId, id, fields }) {
  const item = await tx.getRelationshipRecordForUser("spaceItems", clean(id, 80), userId);
  if (!item || !canViewRecord(item, userId)) throw fail(404, "Item not found.");
  return tx.updateRelationshipRecordForUser("spaceItems", item.id, userId, (draft) => {
    if (typeof fields.title === "string") draft.title = clean(fields.title, 160);
    if (typeof fields.text === "string") draft.text = clean(fields.text, 2000);
    if (fields.date === null || (typeof fields.date === "string" && isDate(fields.date))) draft.date = fields.date;
    if (typeof fields.done === "boolean") draft.done = fields.done;
    draft.version += 1; draft.provenance = { ...draft.provenance, editedByUserId: userId, editedAt: new Date().toISOString() };
  });
}

export async function updateSpace(tx, { userId, id, fields }) {
  const space = await visibleSpace(tx, id, userId);
  return tx.updateRelationshipRecordForUser("spaces", space.id, userId, (draft) => {
    if (typeof fields.title === "string" && clean(fields.title, 80)) draft.title = clean(fields.title, 80);
    if (SPACE_LAYOUTS.includes(fields.layout)) draft.layout = fields.layout;
    if (typeof fields.description === "string") draft.description = clean(fields.description, 400);
    draft.version += 1;
  });
}

export async function archiveSpaceRecord(tx, { userId, collection, id }) {
  const record = await tx.getRelationshipRecordForUser(collection, clean(id, 80), userId);
  if (!record || !canViewRecord(record, userId)) throw fail(404, "Not found.");
  return tx.updateRelationshipRecordForUser(collection, record.id, userId, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.version += 1; });
}

/** Every space this person may see, newest activity first, each with its visible items. */
export async function listSpaces(db, userId) {
  const spaces = (await db.listRelationshipRecordsForUser("spaces", userId)).map((record) => projectRecord(record, userId)).filter(Boolean);
  const items = (await db.listRelationshipRecordsForUser("spaceItems", userId)).map((record) => projectRecord(record, userId)).filter(Boolean);
  return spaces.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((space) => ({
    ...space, items: items.filter((item) => item.spaceId === space.id).sort((a, b) => (a.date || a.createdAt).localeCompare(b.date || b.createdAt)),
  }));
}

/** What an agent may know about spaces in a given scope: titles and recent item titles, never another person's private space. */
export function spaceContext(spaces, { shared }) {
  return spaces.filter((space) => shared ? space.visibility === "shared" : space.visibility === "private").slice(0, 30).map((space) => ({
    id: space.id, title: space.title, layout: space.layout,
    items: space.items.slice(-15).map((item) => ({ id: item.id, title: item.title || item.text.slice(0, 80), date: item.date, done: item.done })),
  }));
}
