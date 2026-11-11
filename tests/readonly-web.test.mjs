import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadonlyWeb, createWebTurn, publicAddress, WEB_LIMITS } from "../server/readonly-web.mjs";

test("public reads use fresh cookie-free contexts and never execute forms or page scripts", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, cookie: req.headers.cookie });
    res.setHeader("Set-Cookie", "session=secret");
    res.end('<h1>虚构餐厅</h1><p>营业时间：17:00–21:00</p><p>两人套餐：280 元</p><form action="/book" method="post"><button>预订</button></form><script>fetch("/book", {method:"POST"})</script>');
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const web = createReadonlyWeb({ testOrigin: origin });
  try {
    const one = await web.read(`${origin}/restaurant`);
    const two = await web.read(`${origin}/restaurant`);
    assert.equal(one.status, "ok");
    assert.match(one.text, /280/);
    assert.notEqual(one.sessionId, two.sessionId);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.method === "GET" && !request.cookie && request.url === "/restaurant"));
    assert.ok(one.fetchedAt && one.url);
  } finally { await web.close(); await new Promise((resolve) => server.close(resolve)); }
});

test("page budgets, timeouts, login failures and persisted failure reuse are bounded", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/slow") { setTimeout(() => res.end("late"), 900).unref(); return; }
    if (req.url === "/login") { res.end('<p>请先登录</p><input type="password"><button>登录</button>'); return; }
    if (req.url === "/blocked") { res.writeHead(403); res.end("denied"); return; }
    if (req.url === "/large") { res.end("x".repeat(WEB_LIMITS.bytes + 1)); return; }
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://127.0.0.1:1/private" }); res.end(); return; }
    res.end("public");
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reader = createReadonlyWeb({ testOrigin: origin });
  try {
    const first = createWebTurn({ reader });
    await first.read([`${origin}/login`, `${origin}/blocked`, `${origin}/large`, `${origin}/fourth`]);
    assert.deepEqual(first.results.map((row) => row.status), ["login_required", "blocked", "too_large"]);
    assert.ok(!requests.includes("/fourth"));
    const restarted = createWebTurn({ reader: createReadonlyWeb({ testOrigin: origin }), failures: JSON.parse(JSON.stringify(first.failures)) });
    await restarted.read([`${origin}/login`]);
    assert.equal(restarted.results[0].cached, true);
    assert.equal(requests.filter((url) => url === "/login").length, 1);
    assert.equal((await createReadonlyWeb({ testOrigin: origin, timeoutMs: 100 }).read(`${origin}/slow`)).status, "timeout");
    assert.equal((await reader.read(`${origin}/redirect`)).status, "unsafe_url");
    for (const url of ["file:///etc/passwd", "http://127.0.0.1/", "http://169.254.169.254/", `${origin}/checkout`, `${origin}/?action=delete`]) assert.equal((await reader.read(url)).status, "unsafe_url");
    for (const address of ["::1", "::ffff:127.0.0.1", "10.0.0.1", "192.168.1.2", "100.64.0.1", "0.0.0.0"]) assert.equal(publicAddress(address), false);
  } finally { await reader.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
