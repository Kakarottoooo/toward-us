import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app.mjs";
import { serveClient } from "./client-static.mjs";
import { createMediator } from "./mediator.mjs";
import { createPushDelivery } from "./push-delivery.mjs";
import { createStore } from "./store.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// Local secrets (for example OPENAI_API_KEY for voice calls) live outside the repository, in a file only the owner edits.
// Values already set in the environment win; hosted deployments set them there instead.
const envFile = process.env.TOWARD_US_ENV_FILE || resolve(homedir(), ".pinky.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);
const dataFile = resolve(process.env.TOWARD_US_DATA_FILE || resolve(root, "data", "toward-us.local.json"));
const store = await createStore(dataFile, process.env.DATABASE_URL);
const mediator = createMediator();
const app = createApiApp({ store, mediator, production });
// Catch up persisted jobs after a restart; external ticks wake sleeping hosts.
const maintain = () => void app.locals.runMaintenance().catch(() => console.error("Reminder maintenance will retry on the next tick."));
maintain();
// A host nothing ticks from outside (the founder's own dogfood server) still sends reminders, the evening daily question and
// partner pushes on time. Runs are idempotent, so an external tick as well is harmless.
setInterval(maintain, 5 * 60_000).unref();

// An unfurler should never open the invitation, count as a partner, or learn either person's name.
const invitePreview = {
  en: ["Join your partner on Ourever", "Open your invitation to start a private space for the two of you."],
  es: ["Únete a tu pareja en Ourever", "Abre la invitación para empezar a compartir un espacio privado en pareja."],
  zh: ["伴侣邀请你加入 Ourever", "打开邀请，开启只属于你们两个人的共同空间。"],
};
function serveInvitePage(getTemplate) {
  app.get("/", async (req, res, next) => {
    if (typeof req.query.invite !== "string") return next();
    const host = req.get("host") || "";
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return res.sendStatus(400);
    const preferred = String(req.query.lang || "").split("-")[0].toLowerCase();
    const language = Object.hasOwn(invitePreview, preferred) ? preferred : req.acceptsLanguages("en", "es", "zh") || "en";
    const [title, description] = invitePreview[language];
    const image = `${req.protocol === "https" ? "https" : "http"}://${host}/assets/brand/share-preview.jpg`;
    const html = (await getTemplate(req))
      .replace(/<meta property="og:url"[^>]*>/, "")
      .replace(/((?:property="og:title"|name="twitter:title") content=")[^"]*/g, `$1${title}`)
      .replace(/((?:property="og:description"|name="twitter:description"|name="description") content=")[^"]*/g, `$1${description}`)
      .replace(/((?:property="og:image"|name="twitter:image") content=")[^"]*/g, `$1${image}`);
    res.set("Cache-Control", "private, no-store").vary("Accept-Language").type("html").send(html);
  });
}

if (production) {
  const clientRoot = resolve(root, "dist", "client");
  if (!existsSync(clientRoot)) throw new Error("Production build not found. Run npm run build first.");
  const indexPath = resolve(clientRoot, "index.html");
  const indexTemplate = await readFile(indexPath, "utf8");
  serveInvitePage(() => indexTemplate);
  app.get("/j/:code", (req, res) => {
    const code = String(req.params.code || "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return res.redirect(302, "/demo");
    const host = String(req.get("host") || "");
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return res.sendStatus(400);
    const origin = `${req.protocol}://${host}`;
    const html = indexTemplate
      .replace('property="og:url" content="/demo"', `property="og:url" content="${origin}/j/${code}"`)
      .replace('property="og:image" content="/assets/brand/share-preview.jpg"', `property="og:image" content="${origin}/assets/brand/share-preview.jpg"`)
      .replace('name="twitter:image" content="/assets/brand/share-preview.jpg"', `name="twitter:image" content="${origin}/assets/brand/share-preview.jpg"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(html);
  });
  serveClient(app, clientRoot);
} else {
  const { createServer: createViteServer } = await import("vite");
  // DEV_ALLOWED_HOSTS lets a phone reach the dev server through a tunnel such as Tailscale serve (comma-separated hostnames).
  const vite = await createViteServer({ root, appType: "spa", server: { middlewareMode: true, allowedHosts: (process.env.DEV_ALLOWED_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean) } });
  serveInvitePage(async () => vite.transformIndexHtml("/", await readFile(resolve(root, "index.html"), "utf8")));
  app.use(vite.middlewares);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Ourever is running on http://127.0.0.1:${port}`);
  console.log(`AI mediation: ${mediator.aiReady ? `ready (${mediator.model})` : "local fallback"}`);
  console.log(`Identity and storage: cookie sessions + ${store.kind}`);
  console.log(`Browser push: ${createPushDelivery().enabled ? "on" : "off (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are not all set)"}`);
  console.log("Audio is processed in memory and is not persisted by this server.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
