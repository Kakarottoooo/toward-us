import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import childProcess from "node:child_process";
import { register, syncBuiltinESMExports } from "node:module";

test("evaluation-only adapter routes both tiers with separate hard budget and subscription-only configuration", async (t) => {
  mkdirSync("work/task41", { recursive: true });
  const directory = mkdtempSync(resolve("work/task41/adapter-test-"));
  for (const key of Object.keys(process.env)) if (/^(OPENAI_|ANTHROPIC_)/.test(key)) delete process.env[key];
  process.env.AI_PROVIDER = "claude-cli";
  const calls = [];
  const mock = t.mock.method(childProcess, "spawn", (command, args) => {
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.equal(process.env.OPENAI_API_KEY, undefined); assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    calls.push({ command, args });
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on("finish", () => queueMicrotask(() => {
      writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ reply: "synthetic", sendableDraft: null, activityDescription: null }));
      child.stdout.end(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) + "\n");
      child.emit("close", 0);
    }));
    return child;
  });
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  register(new URL("./codex-loader.mjs", import.meta.url));
  const { configureCodexProduct } = await import("./codex-client.mjs");
  const file = join(directory, "budget.json");
  configureCodexProduct({ directory, file, context: new AsyncLocalStorage(), maxCalls: 2 });
  const { createMediator } = await import("../../server/mediator.mjs");
  const mediator = createMediator({ apiKey: "" });
  await mediator.checkReplySources({ request: "synthetic", reply: "synthetic" });
  await mediator.rewriteReply({ request: "synthetic", reply: "synthetic", issues: [] });
  assert.deepEqual(calls.map(({ args }) => args[args.indexOf("--model") + 1]), ["gpt-5.6-luna", "gpt-5.6-sol"]);
  await assert.rejects(mediator.rewriteReply({ request: "synthetic" }), /budget reached/);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).codexCalls, 2);
});
