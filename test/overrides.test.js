import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOverride, find } from "../src/overrides.js";

const base = () => ({ ref: "layout/card@1.0.0", props: { title: "T" }, children: [
  { ref: "layout/grid@1.0.0", props: { areas: "a b\nc c" }, children: {
    a: { ref: "kpi/number@1.0.0", data: { source: "sales.total" } },
    b: { ref: "todo/list@1.0.0", data: { source: "tasks.mine" } },
    c: { ref: "charts/line@1.0.0", props: { title: "old" }, data: { source: "analytics.revenue" } } } },
  { ref: "text/block@1.0.0", props: { content: "hi" } },
] });
const run = (patches) => applyOverride(base(), { name: "t", patches });

test("does not mutate the input", () => { const b = base(); applyOverride(b, { patches: [{ op: "remove", target: "a" }] }); assert.ok(b.children[0].children.a); });
test("set-areas", () => assert.equal(run([{ op: "set-areas", target: "layout/grid", areas: "c c\na b" }]).tree.children[0].props.areas, "c c\na b"));
test("set-props merges", () => { const t = run([{ op: "set-props", target: "charts/line", props: { period: "7d" } }]).tree; assert.deepEqual(t.children[0].children.c.props, { title: "old", period: "7d" }); });
test("set-data replaces", () => assert.deepEqual(run([{ op: "set-data", target: "c", data: { source: "x" } }]).tree.children[0].children.c.data, { source: "x" }));
test("replace by child name and by component name", () => {
  assert.equal(run([{ op: "replace", target: "c", with: { ref: "tables/simple@1.0.0" } }]).tree.children[0].children.c.ref, "tables/simple@1.0.0");
  assert.equal(run([{ op: "replace", target: "text/block", with: { ref: "kpi/number@1.0.0" } }]).tree.children[1].ref, "kpi/number@1.0.0");
});
test("remove from named and from array children", () => {
  assert.equal(run([{ op: "remove", target: "a" }]).tree.children[0].children.a, undefined);
  assert.equal(run([{ op: "remove", target: "text/block" }]).tree.children.length, 1);
});
test("insert into named (with area) and into array (before)", () => {
  const t = run([{ op: "insert", target: "layout/grid", name: "d", node: { ref: "text/block@1.0.0" }, area: "a b\nc c\nd d" }]).tree;
  assert.equal(t.children[0].children.d.ref, "text/block@1.0.0"); assert.equal(t.children[0].props.areas, "a b\nc c\nd d");
  const u = run([{ op: "insert", target: "layout/card", node: { ref: "kpi/number@1.0.0" }, before: "text/block" }]).tree;
  assert.equal(u.children[1].ref, "kpi/number@1.0.0"); assert.equal(u.children.length, 3);
});
test("move within array children", () => assert.equal(run([{ op: "move", target: "text/block", to: 0 }]).tree.children[0].ref, "text/block@1.0.0"));
test("errors: target not found, unknown op, move on named", () => {
  const r = run([{ op: "remove", target: "zzz" }, { op: "explode", target: "a" }, { op: "move", target: "a", to: 0 }]);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0].message, /not found/); assert.match(r.errors[1].message, /unknown op/); assert.match(r.errors[2].message, /array children/);
});
test("find returns parent and key", () => { const f = find(base(), "b"); assert.equal(f.key, "b"); assert.ok(f.parent.a); });
