import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { validateSpec } from "@json-render/core";
import { resolve, clearResolveCache } from "../src/resolver.js";
import { tempProject } from "./helpers.js";

let p; before(async () => { p = await tempProject(); }); after(() => p.cleanup());
const calls = [];
const sources = {
  "analytics.revenue": async (params) => { calls.push("rev"); return [{ date: "d", value: 1 }]; },
  "sales.total": async () => 10, "sales.by_region": async () => [{ region: "N", total: 1 }],
  "tasks.mine": async (_, { user }) => [{ id: 1, title: user }], "stock.levels": async () => [],
};

test("base page: valid json-render spec, data in state, $state in props, names for grid", async () => {
  const r = await resolve(p.root, "home", { user: "x", role: "marketing", sources });
  assert.deepEqual(r.errors, []);
  assert.equal(validateSpec(r.spec).valid, true);
  const grid = Object.values(r.spec.elements).find(e => e.type === "layout/grid@1.0.0");
  assert.deepEqual(grid.props.names, ["chart", "table", "kpi", "todo"]);
  const chart = Object.values(r.spec.elements).find(e => e.type === "charts/line@1.0.0");
  assert.equal(chart.props.data.$state.startsWith("/data/"), true);
  assert.deepEqual(r.spec.state.data[chart.props.data.$state.slice(6)], [{ date: "d", value: 1 }]);
  assert.equal(r.spec.state.user.id, "x");
});
test("user override applied (giulia), role override applied (magazzino), role before user", async () => {
  const g = await resolve(p.root, "home", { user: "giulia", role: "marketing", sources });
  assert.match(Object.values(g.spec.elements).find(e => e.type === "layout/grid@1.0.0").props.areas, /^kpi/);
  const m = await resolve(p.root, "home", { user: "marco", role: "magazzino", sources });
  assert.deepEqual(m.errors, []);
  assert.equal(Object.values(m.spec.elements).filter(e => e.type.startsWith("pt/")).length, 0);
  assert.ok(Object.values(m.spec.elements).some(e => e.props.data?.$state === "/data/stock_levels"));
  await writeFile(join(p.root, "overrides", "user-marco.yaml"), "extends: home\npatches:\n  - { op: remove, target: todo }\n");
  const m2 = await resolve(p.root, "home", { user: "marco", role: "magazzino", sources });
  assert.equal(Object.values(m2.spec.elements).some(e => e.type === "todo/list@1.0.0"), false);
});
test("invalid nodes become pt/fallback, the rest renders, sources not called for them", async () => {
  calls.length = 0;
  const r = await resolve(p.root, "home", { user: "anon", sources });
  const fb = Object.values(r.spec.elements).filter(e => e.type === "pt/fallback");
  assert.equal(fb.length, 3);
  assert.match(fb[0].props.reason, /cannot read/);
  assert.ok(Object.values(r.spec.elements).some(e => e.type === "todo/list@1.0.0"));
  assert.equal(calls.length, 0);
  assert.equal(validateSpec(r.spec).valid, true);
});
test("same source fetched once per page", async () => {
  await writeFile(join(p.root, "pages", "twice.yaml"), "page: twice\nlayout:\n  ref: layout/stack@1.0.0\n  children:\n    - { ref: charts/line@1.0.0, data: { source: analytics.revenue } }\n    - { ref: charts/line@1.0.0, data: { source: analytics.revenue } }\n");
  calls.length = 0;
  await resolve(p.root, "twice", { role: "marketing", sources });
  assert.equal(calls.length, 1);
});
test("override that extends another page is ignored", async () => {
  await writeFile(join(p.root, "overrides", "user-zed.yaml"), "extends: other\npatches:\n  - { op: remove, target: todo }\n");
  const r = await resolve(p.root, "home", { user: "zed", role: "marketing", sources });
  assert.ok(Object.values(r.spec.elements).some(e => e.type === "todo/list@1.0.0"));
});
test("cache: same key skips sources; override edit, fresh and maxAge bypass it", async () => {
  clearResolveCache();
  let hits = 0;
  const counted = { ...sources, "analytics.revenue": async () => { hits++; return []; } };
  const opts = { user: "cachy", role: "marketing", sources: counted };
  await resolve(p.root, "home", opts); await resolve(p.root, "home", opts);
  assert.equal(hits, 1);
  const ov = join(p.root, "overrides", "user-cachy.yaml");
  await writeFile(ov, "extends: home\npatches: []\n");
  const t = new Date(Date.now() + 5000); await utimes(ov, t, t);
  await resolve(p.root, "home", opts);
  assert.equal(hits, 2);
  await resolve(p.root, "home", { ...opts, fresh: true });
  assert.equal(hits, 3);
  await new Promise(r => setTimeout(r, 10));
  await resolve(p.root, "home", { ...opts, maxAge: 1 });
  assert.equal(hits, 4);
  await resolve(p.root, "home", opts);
  assert.equal(hits, 4);
});
