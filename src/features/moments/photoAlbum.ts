// A connected iPhone album turns into the couple's memories (founder 11-05). Only inside the iPhone App: the native
// PinkyPhotos plugin reads the album the member picked; the server decides which day-and-place memories are new and asks
// for a few photos of each. Nothing here may throw into React.
import type { Language } from "../../i18n";

type Status = "authorized" | "limited" | "denied" | "unknown";
export type PhotoAlbum = { id: string; title: string; count: number; shared: boolean };
type Asset = { id: string; takenAt: string; day: string; lat?: number; lon?: number };
type Plan = { events: Array<{ key: string; day: string; lat: number | null; lon: number | null; count: number; assets: string[] }>; remaining: number; made: number };
type Plugin = {
  access(options: { ask?: boolean }): Promise<{ status: Status }>;
  albums(): Promise<{ albums: PhotoAlbum[] }>;
  scan(options: { albumId: string }): Promise<{ assets: Asset[] }>;
  thumbnail(options: { id: string; size?: number }): Promise<{ data: string }>;
  place(options: { lat: number; lon: number; locale: string }): Promise<{ name: string }>;
  pickFace(): Promise<{ print: string; face: string }>;
  findTogether(options: { a: string; b: string; since?: number; limit?: number }): Promise<{ assets: Array<Asset & { score: number }>; scanned: number; withTwoFaces: number }>;
  addListener(event: "findProgress", listener: (data: { done: number; total: number; found: number }) => void): Promise<{ remove: () => void }>;
};
export type Progress = { made: number; remaining: number; running: boolean; error: string };

const ALBUM_KEY = "pinky-photo-album", LAST_KEY = "pinky-photo-album-last";
const AUTO_EVERY_MS = 6 * 60 * 60 * 1000;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } };

export function photoPlugin(): Plugin | null {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PinkyPhotos?: Plugin } } }).Capacitor;
    return cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios" ? cap.Plugins?.PinkyPhotos || null : null;
  } catch { return null; }
}
export const connectedAlbum = () => { try { return JSON.parse(read(ALBUM_KEY) || "null") as { id: string; title: string } | null; } catch { return null; } };
export const forgetAlbum = () => { write(ALBUM_KEY, null); write(LAST_KEY, null); };

export async function askPhotoAccess(): Promise<Status> {
  try { return (await photoPlugin()!.access({ ask: true })).status; } catch { return "unknown"; }
}
export async function listAlbums(): Promise<PhotoAlbum[]> {
  try { return (await photoPlugin()!.albums()).albums; } catch { return []; }
}

const json = async <T,>(path: string, body: unknown) => {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || String(response.status));
  return payload as T;
};
const upload = async (base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const response = await fetch("/api/photos?scope=shared", { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: bytes });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || String(response.status));
  return payload.photo.id as string;
};

let running: Promise<void> | null = null;
const listeners = new Set<(progress: Progress) => void>();
let last: Progress = { made: 0, remaining: 0, running: false, error: "" };
const report = (progress: Partial<Progress>) => { last = { ...last, ...progress }; listeners.forEach((listener) => listener(last)); };
export function onPhotoProgress(listener: (progress: Progress) => void) { listeners.add(listener); listener(last); return () => { listeners.delete(listener); }; }

/** Connects an album and makes every memory it holds, newest first, a few at a time. Later calls only add what is new. */
export function syncAlbum(album: { id: string; title: string }, language: Language) {
  write(ALBUM_KEY, JSON.stringify(album));
  return addPhotos(async (plugin) => (await plugin.scan({ albumId: album.id })).assets, language, true);
}

/** Makes memories from photos the member chose (找你们俩的合照), the same way an album does. */
export function addChosenPhotos(assets: Asset[], language: Language) { return addPhotos(async () => assets, language, false); }

function addPhotos(source: (plugin: Plugin) => Promise<Asset[]>, language: Language, album: boolean) {
  if (running) return running;
  running = (async () => {
    const plugin = photoPlugin(); if (!plugin) return;
    report({ running: true, error: "" });
    try {
      const assets = (await source(plugin)).map((asset) => ({ id: asset.id, takenAt: asset.takenAt, day: asset.day, lat: asset.lat ?? null, lon: asset.lon ?? null }));
      const locale = language === "en" ? "en_US" : language === "es" ? "es_ES" : "zh_CN";
      rounds: for (let round = 0; round < 200; round += 1) {
        const plan = await json<Plan>("/api/photo-memories/plan", { assets });
        report({ made: plan.made, remaining: plan.remaining });
        if (!plan.events.length) break;
        let madeThisRound = 0;
        for (const event of plan.events) {
          const place = event.lat !== null && event.lon !== null ? (await plugin.place({ lat: event.lat, lon: event.lon, locale }).catch(() => ({ name: "" }))).name : "";
          const photoIds: string[] = [];
          for (const id of event.assets) { try { photoIds.push(await upload((await plugin.thumbnail({ id, size: 1280 })).data)); } catch { /* A photo iCloud cannot fetch now is skipped. */ } }
          // A memory whose photos could not be fetched is left for the next run.
          // Paused: today's allowance for album memories is used; the rest follow on a later sync.
          if (photoIds.length) { if ((await json<{ paused?: boolean }>("/api/photo-memories/events", { key: event.key, day: event.day, place, photoIds, count: event.count, language })).paused) break rounds; madeThisRound += 1; report({ made: last.made + 1, remaining: Math.max(0, last.remaining - 1) }); }
        }
        // Nothing could be fetched this round (offline, iCloud busy): stop instead of asking for the same memories again.
        if (!madeThisRound) break;
      }
      if (album) write(LAST_KEY, String(Date.now()));
    } catch (error) { report({ error: (error as Error).message }); }
    finally { report({ running: false }); running = null; }
  })();
  return running;
}

// 找你们俩的合照: the two reference faces (feature prints only, never the photos) stay on this phone for "find new ones".
const FACES_KEY = "pinky-couple-faces", FOUND_KEY = "pinky-couple-found";
export type Face = { print: string; face: string };
export const savedFaces = () => { try { return JSON.parse(read(FACES_KEY) || "null") as { me: Face; partner: Face } | null; } catch { return null; } };
export const saveFaces = (faces: { me: Face; partner: Face } | null) => write(FACES_KEY, faces ? JSON.stringify(faces) : null);
export const lastFound = () => Number(read(FOUND_KEY) || 0);
export async function pickFace(): Promise<Face | "no_face" | null> {
  try { return await photoPlugin()!.pickFace(); } catch (error) { return /no_face/.test(String((error as Error).message || error)) ? "no_face" : null; }
}
/** Candidates for photos of the two of them, best first, with progress while the phone looks through the library. */
export async function findTogether(faces: { me: Face; partner: Face }, onProgress: (done: number, total: number) => void, since?: number) {
  const plugin = photoPlugin()!;
  const listener = await plugin.addListener("findProgress", (data) => onProgress(data.done, data.total)).catch(() => null);
  try { const result = await plugin.findTogether({ a: faces.me.print, b: faces.partner.print, limit: 90, ...(since ? { since: since / 1000 } : {}) }); write(FOUND_KEY, String(Date.now())); return result; }
  finally { listener?.remove(); }
}
export const thumbnail = async (id: string) => { try { return `data:image/jpeg;base64,${(await photoPlugin()!.thumbnail({ id, size: 300 })).data}`; } catch { return ""; } };

/** On opening the App: quietly add new photos from the connected album, at most every few hours. */
export function autoSyncAlbum(language: Language) {
  try {
    const album = connectedAlbum(); if (!album || !photoPlugin()) return;
    if (Date.now() - Number(read(LAST_KEY) || 0) < AUTO_EVERY_MS) return;
    void photoPlugin()!.access({}).then(({ status }) => { if (status === "authorized" || status === "limited") void syncAlbum(album, language); }).catch(() => {});
  } catch { /* best effort */ }
}
