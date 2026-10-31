// Contract with json-render: if these break after an upgrade, the resolver or the client must change.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { applySpecPatch, diffToPatches, validateSpec } from "@json-render/core";
import { Page } from "../src/client.jsx";
import { resolve } from "../src/resolver.js";
import { tempProject, templates } from "./helpers.js";
import { createRequire } from "node:module";

let p, registry;
before(async () => {
  p = await tempProject();
  const reg = (await import("yaml")).parse(await readFile(`${p.root}/components/registry.yaml`, "utf8"));
  registry = {};
  for (const [name, def] of Object.entries(reg)) for (const [ver, v] of Object.entries(def.versions))
    registry[`${name}@${ver}`] = (await import(`${templates}/components/${v.impl.replace("./", "")}`)).default;
});
after(() => p.cleanup());

const sources = {
  "analytics.revenue": async () => [{ date: "2026-10-01", value: 100 }, { date: "2026-10-02", value: 120 }],
  "sales.total": async () => 42, "sales.by_region": async () => [{ region: "N", total: 1 }],
  "tasks.mine": async () => [{ id: 1, title: "t", done: false }], "stock.levels": async () => [{ sku: "A", name: "x", qty: 1 }],
};
const render = async (user, role) => renderToString(h(Page, { resolved: await resolve(p.root, "home", { user, role, sources }), registry }));

test("pinned versions of json-render", () => {
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json");
  for (const n of ["@json-render/core", "@json-render/react"]) assert.equal(req(`../node_modules/${n}/package.json`).version, pkg.dependencies[n]);
});
test("renders the demo home for marketing: all four widgets, $state resolved into props", async () => {
  const html = await render("x", "marketing");
  assert.match(html, /grid-template-areas:&quot;chart chart&quot;/);
  assert.match(html, /42/); assert.match(html, /2026-10-02/); assert.match(html, /region/); assert.match(html, /\bt\b/);
  assert.doesNotMatch(html, /\$state/);
});
test("renders magazzino view without sales and anon view with fallbacks", async () => {
  const m = await render("marco", "magazzino");
  assert.match(m, /Giacenze/); assert.doesNotMatch(m, /42/);
  const a = await render("anon", undefined);
  assert.equal((a.match(/cannot read/g) ?? []).length, 3);
});
test("applySpecPatch and diffToPatches round-trip", () => {
  const a = { root: "r", elements: { r: { type: "x", props: { t: 1 }, children: [] } } };
  const b = { root: "r", elements: { r: { type: "x", props: { t: 2 }, children: [] } } };
  const patches = diffToPatches(a, b);
  assert.equal(patches[0].path, "/elements/r/props/t");
  let s = structuredClone(a); for (const pt of patches) s = applySpecPatch(s, pt);
  assert.deepEqual(s, b);
  assert.equal(validateSpec(b).valid, true);
});
