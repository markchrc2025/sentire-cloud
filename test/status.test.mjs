import { test } from "node:test";
import assert from "node:assert/strict";
import { probe, checkAll } from "../src/status.js";
import { handler } from "../src/server.js";
import { readFileSync } from "node:fs";

const ok = (status) => async () => new Response("", { status });

test("2xx, 3xx and auth walls count as up; 5xx and errors as down", async () => {
  const s = { id: "x", url: "https://x.test", health: "/" };
  assert.equal((await probe(s, { fetchImpl: ok(200) })).up, true);
  assert.equal((await probe(s, { fetchImpl: ok(302) })).up, true);
  assert.equal((await probe(s, { fetchImpl: ok(403) })).up, true);
  assert.equal((await probe(s, { fetchImpl: ok(502) })).up, false);
  const r = await probe(s, { fetchImpl: async () => { throw new TypeError("fail"); } });
  assert.equal(r.up, false);
  assert.equal(r.error, "unreachable");
});

test("every configured service is checked", async () => {
  const cfg = JSON.parse(readFileSync(new URL("../services.json", import.meta.url)));
  const d = await checkAll(cfg, { fetchImpl: ok(200) });
  assert.equal(d.products.length, 5);
  assert.equal(d.allUp, true);
  assert.ok(d.products.every((p) => p.name.startsWith("Sentire ")));
});

test("server serves the console, status and blocks path escape", async () => {
  const h = handler(() => ({ allUp: true }));
  const call = (url) => new Promise((resolve) => {
    let status, body = "";
    h({ url }, { writeHead: (s) => (status = s), end: (b) => resolve({ status, body: String(b ?? "") }) });
  });
  assert.equal((await call("/healthz")).status, 200);
  assert.equal(JSON.parse((await call("/api/status")).body).allUp, true);
  const page = await call("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /Sentire Cloud/);
  assert.notEqual((await call("/../services.json")).status, 200);
});
