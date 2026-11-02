import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createHandoffRouter, handoffUrl } from "../server/handoff.mjs";

test("hand-off links allow only phone-finishable schemes", () => {
  assert.equal(handoffUrl({ url: "https://maps.apple.com/?q=Tartine%20SF" }), "https://maps.apple.com/?q=Tartine%20SF");
  assert.equal(handoffUrl({ url: "sms:&body=See%20you%20at%207" }), "sms:&body=See%20you%20at%207");
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url", 42]) assert.equal(handoffUrl({ url }), null);
  assert.match(handoffUrl({ localDateTime: "2026-11-07T19:30", title: "Dinner", location: "Tartine", timezone: "America/Los_Angeles" }), /^\/api\/handoff\/event\.ics\?/);
  assert.equal(handoffUrl({ localDateTime: "tomorrow", title: "Dinner" }), null);
});

test("the calendar hand-off returns an event file built only from its parameters", async (t) => {
  const app = express(); app.use("/api", createHandoffRouter());
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/handoff/event.ics`;
  const response = await fetch(`${base}?${new URLSearchParams({ title: "Dinner, then a walk", start: "2026-11-07T19:30", tz: "America/Los_Angeles", location: "Tartine; SF" })}`);
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8");
  const body = await response.text();
  assert.match(body, /DTSTART;TZID=America\/Los_Angeles:20261107T193000/);
  assert.match(body, /DTEND;TZID=America\/Los_Angeles:20261107T203000/);
  assert.ok(body.includes("SUMMARY:Dinner\\, then a walk"));
  assert.ok(body.includes("LOCATION:Tartine\\; SF"));
  assert.equal((await fetch(`${base}?title=x&start=soon`)).status, 400);
});
