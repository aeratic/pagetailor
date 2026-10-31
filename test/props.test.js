import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { loadYaml } from "../src/loader.js";
import { parseType, validateProps, propsToZod, buildCatalog } from "../src/props.js";
import { templates } from "./helpers.js";

test("parseType", () => {
  assert.deepEqual(parseType("string"), { base: "string", optional: false });
  assert.deepEqual(parseType("number?"), { base: "number", optional: true });
  assert.deepEqual(parseType("text"), { base: "string", optional: false });
  assert.deepEqual(parseType("enum[a, b,c]?"), { base: "enum", optional: true, values: ["a", "b", "c"] });
  assert.deepEqual(parseType("string[]"), { base: "string[]", optional: false });
  assert.throws(() => parseType("date"));
});

const s = { title: "string", count: "number?", on: "boolean?", kind: "enum[a,b]", tags: "string[]?", nums: "number[]?" };
test("validateProps: valid, optional omitted, data/names ignored", () => {
  assert.deepEqual(validateProps({ title: "x", kind: "a", data: 1, names: ["q"] }, s), []);
  assert.deepEqual(validateProps({ title: "x", kind: "b", count: 2, on: true, tags: ["t"], nums: [1] }, s), []);
});
test("validateProps: each error kind", () => {
  assert.deepEqual(validateProps({ kind: "a" }, s), ['prop "title": missing required']);
  assert.deepEqual(validateProps({ title: "x", kind: "a", foo: 1 }, s), ['prop "foo": unknown prop']);
  assert.deepEqual(validateProps({ title: 3, kind: "a" }, s), ['prop "title": expected string']);
  assert.deepEqual(validateProps({ title: "x", kind: "z" }, s), ['prop "kind": value "z" not in [a, b]']);
  assert.deepEqual(validateProps({ title: "x", kind: "a", tags: [1], on: "yes" }, s), ['prop "on": expected boolean', 'prop "tags": expected string[]']);
});
test("validateProps: no schema accepts anything", () => assert.deepEqual(validateProps({ any: 1 }, undefined), []));

test("propsToZod", () => {
  const zs = propsToZod(s, z);
  assert.equal(zs.safeParse({ title: "x", kind: "a", count: null }).success, true);
  assert.equal(zs.safeParse({ title: 1, kind: "c" }).success, false);
  assert.equal(propsToZod(undefined, z).safeParse({ whatever: 1 }).success, true);
});

test("buildCatalog works with defineCatalog, slots only on containers", async () => {
  const registry = await loadYaml(join(templates, "components", "registry.yaml"));
  const cat = buildCatalog(registry, z);
  assert.doesNotThrow(() => defineCatalog(schema, cat));
  assert.deepEqual(cat.components["layout/card@1.0.0"].slots, ["default"]);
  assert.equal(cat.components["text/block@1.0.0"].slots, undefined);
  assert.equal(typeof cat.components["kpi/number@1.0.0"].description, "string");
  assert.deepEqual(cat.actions, {});
});
test("validateProps: unknown type in schema is reported, not thrown", () => {
  assert.deepEqual(validateProps({ when: "x", title: 1 }, { when: "date", title: "string" }), ['prop "when": unknown type "date" in registry', 'prop "title": expected string']);
});
