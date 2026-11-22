/** Messages sent but not yet confirmed by the server, kept on this device per account so a reload or a dropped connection
 * never loses them. Each keeps its idempotency key (itemId), so sending it again can't store a second copy. */
export function outbox<T extends { itemId: string }>(key: string) {
  const read = (): T[] => {
    try { const items = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(items) ? items.filter((item) => typeof item?.itemId === "string") : []; }
    catch { return []; }
  };
  const write = (items: T[]) => {
    try { if (items.length) localStorage.setItem(key, JSON.stringify(items.slice(-20))); else localStorage.removeItem(key); } catch { /* kept in memory for this visit */ }
  };
  return {
    read,
    add: (item: T) => write([...read().filter((entry) => entry.itemId !== item.itemId), item]),
    remove: (itemId: string) => write(read().filter((entry) => entry.itemId !== itemId)),
  };
}
