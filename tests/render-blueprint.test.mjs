import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Render installs build-time dependencies under NODE_ENV=production", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

  assert.match(
    blueprint,
    /buildCommand:\s+npm ci --include=dev && npm run build && npm run test:app/,
  );
  assert.match(blueprint, /key:\s+NODE_ENV\s+value:\s+production/);
});

test("Render runs on paid plans and keeps uploads on a persistent disk", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  assert.doesNotMatch(blueprint, /plan:\s+free/, "free sleeps, loses uploads and its database expires");
  assert.match(blueprint, /disk:\s+name:\s+pinky-media\s+mountPath:\s+\/var\/data/);
  assert.match(blueprint, /key:\s+TOWARD_US_MEDIA_DIR\s+value:\s+\/var\/data\/media/, "uploads must live on the disk");
});
