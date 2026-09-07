const { REMINDER_BASE_URL, REMINDER_RUN_SECRET } = process.env;
let base;
try { base = new URL(REMINDER_BASE_URL); } catch { throw new Error("Configure REMINDER_BASE_URL with the production HTTPS origin."); }
if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !REMINDER_RUN_SECRET || REMINDER_RUN_SECRET.length < 32) throw new Error("Reminder scheduler configuration is incomplete.");
try {
  const response = await fetch(new URL("/api/internal/reminders/run", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(110_000),
    headers: { authorization: `Bearer ${REMINDER_RUN_SECRET}`, "content-type": "application/json" }, body: "{}",
  });
  if (!response.ok) throw new Error(`Reminder runner returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.configured) throw new Error("Browser push is not configured on the server.");
  // Aggregate counters only; no account, relationship, reminder, endpoint or message content.
  console.log(JSON.stringify(Object.fromEntries(["claimed", "accepted", "failed", "cancelled"].map((key) => [key, Number(result[key]) || 0]))));
} catch (error) {
  console.error(error.message?.startsWith("Reminder runner returned HTTP") || error.message === "Browser push is not configured on the server." ? error.message : "Reminder runner failed or timed out. No private delivery data was logged.");
  process.exitCode = 1;
}
