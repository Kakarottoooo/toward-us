export const DRAFTS = "drafts";
export const OUTBOX = "outbox";

let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ourever-feedback", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(DRAFTS);
        request.result.createObjectStore(OUTBOX, { keyPath: ["owner", "id"] }).createIndex("owner", "owner");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    }).catch((error) => { opening = undefined; throw error; });
  }
  return opening;
}
export async function read<T>(table: string, select: (store: IDBObjectStore) => IDBRequest) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const request = select(db.transaction(table).objectStore(table));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function write(tables: string[], apply: (transaction: IDBTransaction) => void) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(tables, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("storage"));
    apply(tx);
  });
}
