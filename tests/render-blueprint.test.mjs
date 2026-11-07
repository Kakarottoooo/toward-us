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

test("uploads only point at a disk the blueprint actually has", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  // A free service can't have a disk; pointing uploads at /var/data without one would break every upload.
  const media = /key:\s+TOWARD_US_MEDIA_DIR\s+value:\s+\/var\/data/.test(blueprint);
  const disk = /^\s+disk:\s*$[\s\S]*?mountPath:\s+\/var\/data/m.test(blueprint);
  assert.equal(media, disk, "TOWARD_US_MEDIA_DIR and the disk go together");
  if (disk) assert.doesNotMatch(blueprint.split("databases:")[0], /^\s+plan:\s+free/m, "a disk needs a paid web plan");
});
