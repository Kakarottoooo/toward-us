import assert from "node:assert/strict";

// Exercise the real consent and screening paths with an offline provider for benign fixture content.
export function mockModeration(t) {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "local-moderation-fixture";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === "https://api.openai.com/v1/moderations") {
      const req = new Request(input, init);
      assert.equal(req.method, "POST");
      const { model, input: items } = await req.json();
      assert.equal(model, "omni-moderation-latest");
      assert.ok(Array.isArray(items) && items.length);
      const count = typeof items[0] === "string" ? items.length : 1;
      return Response.json({ results: Array.from({ length: count }, () => ({ flagged: false })) });
    }
    if (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return originalFetch(input, init);
    }
    throw new Error("Unexpected external request in the moderation fixture");
  });
}
