import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { swapAreas, mergePatch } from "../src/editor.jsx";
import { resolve } from "../src/resolver.js";
import { tempProject } from "./helpers.js";

test("swapAreas swaps every occurrence of both names", () => {
  assert.equal(swapAreas("chart  chart\ntable  kpi\ntable  todo\n", "chart", "table"), "table table\nchart kpi\nchart todo\n");
  assert.equal(swapAreas("a b\n", "a", "zz"), "zz b\n");
  assert.equal(swapAreas("a b", "a", "a"), "a b\n");
});

test("mergePatch replaces set-areas on the same target, appends otherwise", () => {
  const base = [{ op: "set-props", target: "kpi", props: { label: "x" } }, { op: "set-areas", target: "layout/grid", areas: "a\n" }];
  const next = { op: "set-areas", target: "layout/grid", areas: "b\n" };
  assert.deepEqual(mergePatch(base, next), [base[0], next]);
  const other = { op: "set-areas", target: "grid2", areas: "c\n" };
  assert.deepEqual(mergePatch(base, other), [...base, other]);
  assert.deepEqual(mergePatch(undefined, next), [next]);
});

let p; before(async () => { p = await tempProject(); }); after(() => p.cleanup());
test("resolver adds __pt with name and container for the demo home", async () => {
  const sources = new Proxy({}, { get: () => async () => [] });
  const r = await resolve(p.root, "home", { role: "marketing", sources });
  const els = Object.values(r.spec.elements);
  const by = t => els.find(e => e.type === t).props.__pt;
  assert.deepEqual(by("layout/card@1.0.0"), { path: "root", name: "layout/card", container: null });
  assert.deepEqual(by("layout/grid@1.0.0"), { path: "root/0", name: "layout/grid", container: "layout/card" });
  assert.deepEqual(by("charts/line@1.0.0"), { path: "root/0/0", name: "chart", container: "layout/grid" });
  assert.deepEqual(els.filter(e => e.type !== "layout/card@1.0.0" && e.type !== "layout/grid@1.0.0").map(e => e.props.__pt.name).sort(), ["chart", "kpi", "table", "todo"]);
});
