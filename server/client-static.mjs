import { basename, dirname, resolve } from "node:path";
import express from "express";

// Vite names every built script, stylesheet and font after a hash of its content (index-DUkXCe1P.js): a new build gets new
// names, so a file under that name never changes and the browser (and the iPhone app's web view) can keep it for a year
// without asking again. index.html names the current files, so it is always revalidated and a deploy shows up on the
// next open. Files copied from public/ (brand images, device frames) live in subfolders and keep the default.
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";

/** Serves the built web app from `clientRoot`, falling back to index.html for the app's own routes. */
export function serveClient(app, clientRoot) {
  const assets = resolve(clientRoot, "assets");
  const indexPath = resolve(clientRoot, "index.html");
  app.use(express.static(clientRoot, {
    setHeaders(res, file) {
      if (dirname(file) === assets && HASHED_NAME.test(basename(file))) res.setHeader("Cache-Control", IMMUTABLE);
      else if (file.endsWith(".html")) res.setHeader("Cache-Control", REVALIDATE);
    },
  }));
  // A file from an older build that is gone answers 404, not the app's HTML under a script's name.
  app.use("/assets", (_req, res) => res.status(404).set("Cache-Control", "no-store").end());
  app.get("*path", (_req, res) => res.set("Cache-Control", REVALIDATE).sendFile(indexPath));
}
