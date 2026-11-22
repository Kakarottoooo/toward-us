import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createRequestTiming, route } from "../server/timing.mjs";

test("route blanks ids, tokens, emails and drops the query string", () => {
  assert.equal(route("/api/people/123/notes?email=a@b.com"), "/api/people/:id/notes");
  assert.equal(route("/api/spaces/3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718"), "/api/spaces/:id");
  assert.equal(route("/api/invite/abcdefghijklmnopqrstuvwxyz012345/accept"), "/api/invite/:id/accept");
  assert.equal(route("/api/users/someone@example.com/x"), "/api/users/:id/x");
  assert.equal(route("/api/search/caf%C3%A9"), "/api/search/:id");
  assert.equal(route("/api/me"), "/api/me");
  assert.ok(route(`/api/${"segment/".repeat(30)}`).length <= 80);
});

test("only slow requests are logged one by one, and the summary never carries ids or queries", async (t) => {
  const lines = [];
  let clock = 0;
  const timing = createRequestTiming({ log: (line) => lines.push(line), now: () => clock, summaryMs: 0 });
  const app = express();
  app.use(timing);
  app.get("/api/people/:id", (req, res) => { clock += Number(req.query.ms); res.json({ ok: true }); });
  app.post("/api/users/:email/thing", (_req, res) => { clock += 5; res.json({ ok: true }); });
  app.get("/page", (_req, res) => { clock += 999; res.send("hi"); });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (let i = 0; i < 5; i += 1) await fetch(`${base}/api/people/4242?ms=20&token=secret-query-value`);
  await fetch(`${base}/api/people/9999?ms=450&q=hidden`);
  await fetch(`${base}/api/users/person%40example.com/thing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: "body-text" }) });
  await fetch(`${base}/page`);
  await new Promise((done) => setImmediate(done));

  assert.deepEqual(lines, ["[timing] slow GET /api/people/:id 450ms"]);
  timing.summarize();
  assert.ok(lines.includes("[timing] GET /api/people/:id n=6 p50=20ms p95=450ms"), lines.join("\n"));
  assert.ok(lines.includes("[timing] POST /api/users/:id/thing n=1 p50=5ms p95=5ms"), lines.join("\n"));
  const all = lines.join("\n");
  for (const leak of ["4242", "9999", "secret", "hidden", "example.com", "%40", "@", "?", "body-text", "/page"]) assert.ok(!all.includes(leak), `${leak} leaked`);
  lines.length = 0;
  timing.summarize();
  assert.deepEqual(lines, [], "each summary covers a fresh window");
});

test("stored samples are capped per route", () => {
  const lines = [];
  const timing = createRequestTiming({ log: (line) => lines.push(line), summaryMs: 0 });
  for (let i = 0; i < 2000; i += 1) timing.record("GET", "/api/me", 1);
  timing.summarize();
  assert.deepEqual(lines, ["[timing] GET /api/me n=500 p50=1ms p95=1ms"]);
});
