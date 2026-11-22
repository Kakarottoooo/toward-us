import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { DEVICE_CHROME, IMMUTABLE, REVALIDATE, serveClient } from "../server/client-static.mjs";

test("hashed build files are cached for a year, index.html is always revalidated", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ourever-client-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets", "brand"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><script type=module src=/assets/index-DUkXCe1P.js></script>");
  await writeFile(join(root, "assets", "index-DUkXCe1P.js"), "export {};");
  await writeFile(join(root, "assets", "index-CicAf-zV.css"), "body{}");
  await writeFile(join(root, "assets", "brand", "pinky-icon-192.png"), "png");
  await mkdir(join(root, "assets", "iphone"), { recursive: true });
  await writeFile(join(root, "assets", "iphone", "Bezel.png"), "png");
  const app = express();
  serveClient(app, root);
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => { const response = await fetch(base + path); await response.arrayBuffer(); return response; };

  for (const path of ["/assets/index-DUkXCe1P.js", "/assets/index-CicAf-zV.css"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), IMMUTABLE, path);
  }
  for (const path of ["/", "/index.html", "/settings"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), REVALIDATE, path);
    assert.match(response.headers.get("content-type"), /text\/html/, path);
  }
  // Files copied from public/ are versioned by query string, not by name: they are not marked immutable.
  assert.notEqual((await get("/assets/brand/pinky-icon-192.png")).headers.get("cache-control"), IMMUTABLE);
  // The phone frame (QA round 5: Bezel.png, 354 KB, was refetched on every open) is kept a week and revalidated quietly.
  assert.equal((await get("/assets/iphone/Bezel.png")).headers.get("cache-control"), DEVICE_CHROME);
  // A script from an older build is gone: 404, never the app's HTML under a script's name.
  const stale = await get("/assets/index-OLDBUILD.js");
  assert.equal(stale.status, 404);
  assert.equal(stale.headers.get("cache-control"), "no-store");
});
