import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropicClient } from "../server/anthropic-client.mjs";
import { assistantInstructions } from "../server/assistant-agent.mjs";

// Cost pass on the harness (founder 11-10: "首先得先保证我们的模型输出结果保质保量，然后再开始节省成本").

test("the system part is the same bytes for every member, turn and day, and is cached on the API", async (t) => {
  // Nothing per member, per turn or per day may sit in the instructions: any changed byte makes every call pay full price.
  assert.equal(assistantInstructions("zh"), assistantInstructions("zh"));
  assert.doesNotMatch(assistantInstructions("zh"), /\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}-/);

  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await createAnthropicClient({ apiKey: "test-key", model: "m" }).responses.create({ model: "m", instructions: "Stable instructions.", input: "volatile context", text: { format: { type: "json_schema", name: "x", schema: { type: "object", properties: {} } } } }, { maxRetries: 0 });
  assert.deepEqual(body.system, [{ type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } }]);
  assert.equal(body.messages[0].content, "volatile context", "what changes every turn comes after the cached part");
});
