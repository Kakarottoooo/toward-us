import assert from "node:assert/strict";
import test from "node:test";
import { buildIsOlder, LATEST_IOS_BUILD } from "../src/features/membership/platform.ts";

test("older iPhone builds ask to update; current and newer ones do not", () => {
  assert.equal(buildIsOlder("2611.19.8", "2611.19.16"), true);
  assert.equal(buildIsOlder("0", LATEST_IOS_BUILD), true);
  assert.equal(buildIsOlder("2611.19.16", "2611.19.16"), false);
  assert.equal(buildIsOlder("2611.20.1", "2611.19.16"), false);
  assert.equal(buildIsOlder("2612.1", "2611.19.16"), false);
  assert.equal(buildIsOlder("dev", "2611.19.16"), false);
});
