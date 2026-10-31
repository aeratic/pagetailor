import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePatches, collectTargets, patchFields } from "../src/studio/tabs/PeopleTab.jsx";

test("summarizePatches lists op and target", () => {
  assert.equal(summarizePatches([{ op: "set-areas", target: "layout/grid", areas: "a\n" }, { op: "remove", target: "kpi" }]), "set-areas layout/grid, remove kpi");
  assert.equal(summarizePatches(undefined), "");
});

test("collectTargets returns sorted unique child and component names", () => {
  const page = { page: "home", layout: { ref: "layout/card@1.0.0", children: [{ ref: "layout/grid@1.0.0", children: {
    chart: { ref: "charts/line@1.0.0" }, kpi: { ref: "kpi/number@1.0.0" }, k2: { ref: "kpi/number@1.0.0" } } }] } };
  assert.deepEqual(collectTargets(page), ["chart", "charts/line", "k2", "kpi", "kpi/number", "layout/card", "layout/grid"]);
  assert.deepEqual(collectTargets(undefined), []);
});

test("patchFields gives the fields of each op", () => {
  assert.deepEqual(patchFields("set-areas"), ["target", "areas"]);
  assert.deepEqual(patchFields("remove"), ["target"]);
  assert.deepEqual(patchFields("move"), ["target", "to"]);
  assert.deepEqual(patchFields("insert"), ["target", "name", "node", "before", "area"]);
  assert.deepEqual(patchFields("replace"), ["target", "with"]);
});
