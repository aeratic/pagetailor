import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTree, validateManifest, typeAccepts } from "../src/validator.js";

const project = {
  registry: {
    "layout/grid": { versions: { "1.0.0": {} } },
    "text/block": { props: { content: "string", muted: "boolean?" }, versions: { "1.0.0": {} } },
    "charts/line": { accepts: "timeseries<money>", versions: { "1.0.0": {} } },
    "tables/simple": { accepts: "table<any>", versions: { "1.0.0": {}, "2.0.0": {} } },
  },
  catalog: {
    "analytics.revenue": { returns: "timeseries<money>", roles: ["marketing"], params: { period: ["7d", "30d"] } },
    "sales.by_region": { returns: "table<region>", roles: ["*"] },
    "tasks.mine": { returns: "list<task>", roles: ["*"] },
  },
};
const msgs = (tree, opts) => validateTree(tree, project, opts).map(e => e.message);

test("typeAccepts: exact, any, generic any", () => {
  assert.equal(typeAccepts("money", "money"), true);
  assert.equal(typeAccepts("any", "whatever"), true);
  assert.equal(typeAccepts(undefined, "x"), true);
  assert.equal(typeAccepts("table<any>", "table<region>"), true);
  assert.equal(typeAccepts("table<any>", "list<task>"), false);
  assert.equal(typeAccepts("timeseries<money>", "timeseries<number>"), false);
});

test("valid node passes", () => {
  assert.deepEqual(msgs({ ref: "charts/line@1.0.0", data: { source: "analytics.revenue", params: { period: "7d" } } }, { role: "marketing" }), []);
});
test("unknown component / missing version", () => {
  assert.match(msgs({ ref: "nope@1.0.0" })[0], /unknown component "nope"/);
  assert.match(msgs({ ref: "charts/line@9.9.9" })[0], /no version 9.9.9/);
});
test("unknown source", () => assert.match(msgs({ ref: "tables/simple@1.0.0", data: { source: "x.y" } })[0], /unknown data source/));
test("role denied, role none, wildcard role", () => {
  assert.match(msgs({ ref: "charts/line@1.0.0", data: { source: "analytics.revenue" } }, { role: "magazzino" })[0], /role "magazzino" cannot read/);
  assert.match(msgs({ ref: "charts/line@1.0.0", data: { source: "analytics.revenue" } }, { role: null })[0], /role "none" cannot read/);
  assert.deepEqual(msgs({ ref: "charts/line@1.0.0", data: { source: "analytics.revenue" } }), []);
  assert.deepEqual(msgs({ ref: "tables/simple@1.0.0", data: { source: "sales.by_region" } }), []);
});
test("type mismatch", () => {
  assert.match(msgs({ ref: "charts/line@1.0.0", data: { source: "tasks.mine" } }, { role: "marketing" })[0], /accepts timeseries<money> but "tasks.mine" returns list<task>/);
});
test("params: unknown and not allowed", () => {
  const m = msgs({ ref: "charts/line@1.0.0", data: { source: "analytics.revenue", params: { period: "1y", foo: 1 } } }, { role: "marketing" });
  assert.ok(m.some(x => /period=1y not in/.test(x)));
  assert.ok(m.some(x => /no param "foo"/.test(x)));
});
test("grid areas vs children", () => {
  const grid = { ref: "layout/grid@1.0.0", props: { areas: "a b\nc c" }, children: { a: { ref: "tables/simple@1.0.0" }, b: { ref: "tables/simple@1.0.0" }, d: { ref: "tables/simple@1.0.0" } } };
  const m = msgs(grid);
  assert.ok(m.some(x => /area "c" has no child/.test(x)));
  assert.ok(m.some(x => /child "d" is not placed/.test(x)));
});
test("errors carry the path of the child", () => {
  const e = validateTree({ ref: "layout/grid@1.0.0", children: [{ ref: "nope@1" }] }, project);
  assert.equal(e[0].path, "root/0");
});
test("manifest", () => {
  const m = validateManifest({ pages: ["home", "ghost"], home: "nope" }, ["home", "extra"]).map(e => e.message);
  assert.equal(m.length, 3);
});

test("props: valid, unknown, missing, wrong type", () => {
  assert.deepEqual(msgs({ ref: "text/block@1.0.0", props: { content: "hi", muted: true } }), []);
  assert.deepEqual(msgs({ ref: "text/block@1.0.0", props: { content: "hi", bold: true } }), ['prop "bold": unknown prop']);
  assert.deepEqual(msgs({ ref: "text/block@1.0.0", props: { muted: "no" } }), ['prop "content": missing required', 'prop "muted": expected boolean']);
});
test("props: components without schema accept anything", () => {
  assert.deepEqual(msgs({ ref: "tables/simple@1.0.0", props: { whatever: 1 } }), []);
});
