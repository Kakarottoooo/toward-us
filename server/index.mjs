import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiApp } from "./app.mjs";
import { createMediator } from "./mediator.mjs";
import { createStore } from "./store.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);
const dataFile = resolve(process.env.TOWARD_US_DATA_FILE || resolve(root, "data", "toward-us.local.json"));
const store = await createStore(dataFile, process.env.DATABASE_URL);
const mediator = createMediator();
const app = createApiApp({ store, mediator, production });

if (production) {
  const clientRoot = resolve(root, "dist", "client");
  if (!existsSync(clientRoot)) throw new Error("Production build not found. Run npm run build first.");
  app.use(express.static(clientRoot));
  app.get("*path", (_req, res) => res.sendFile(resolve(clientRoot, "index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ root, appType: "spa", server: { middlewareMode: true } });
  app.use(vite.middlewares);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Toward Us is running on http://127.0.0.1:${port}`);
  console.log(`AI mediation: ${mediator.aiReady ? `ready (${mediator.model})` : "local fallback"}`);
  console.log(`Identity and storage: cookie sessions + ${store.kind}`);
  console.log("Audio is processed in memory and is not persisted by this server.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
