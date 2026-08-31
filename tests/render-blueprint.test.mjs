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
