import { test } from "node:test";
import assert from "node:assert/strict";
import { parseType } from "../src/props.js";
import { pascalName as serverPascal } from "../src/files.js";
import { rolesToggle, typeSuggestions, textToValues, valuesToText, sourcesUsedIn, SOURCE_NAME } from "../src/studio/tabs/DataTab.jsx";
import { propToNotation, notationToProp, nextVersion, latestVersion, newComponentEntry, pascalName, COMPONENT_NAME } from "../src/studio/tabs/ComponentsTab.jsx";

const norm = t => ({ base: t.type === "text" ? "string" : t.type, optional: !!t.optional, ...(t.type === "enum" ? { values: t.values } : {}) });

test("propToNotation agrees with parseType for every type", () => {
  for (const type of ["string", "number", "boolean", "text", "string[]", "number[]"])
    for (const optional of [false, true]) assert.deepEqual(parseType(propToNotation({ type, optional })), norm({ type, optional }));
  const e = { type: "enum", optional: true, values: ["a", "b"] };
  assert.equal(propToNotation(e), "enum[a,b]?");
  assert.deepEqual(parseType(propToNotation(e)), norm(e));
});

test("notationToProp round-trips registry notation", () => {
  for (const s of ["string", "string?", "text", "number[]", "boolean?", "enum[a,b]", "enum[x]?"]) assert.equal(propToNotation(notationToProp(s)), s);
  assert.deepEqual(notationToProp("enum[ a , b ]?"), { type: "enum", optional: true, values: ["a", "b"] });
});

test("rolesToggle handles everyone and single roles", () => {
  assert.deepEqual(rolesToggle(["admin"], "*", true), ["*"]);
  assert.deepEqual(rolesToggle(["*"], "*", false), []);
  assert.deepEqual(rolesToggle(["*"], "admin", true), ["admin"]);
  assert.deepEqual(rolesToggle(["admin", "marketing"], "admin", false), ["marketing"]);
  assert.deepEqual(rolesToggle(["admin"], "admin", true), ["admin"]);
});

test("type suggestions include base and used types once", () => {
  const s = typeSuggestions({ a: { returns: "table<region>" }, b: { returns: "money" } }, { x: { accepts: "table<stock>" } });
  assert.ok(s.includes("table<region>") && s.includes("table<stock>") && s.includes("list<task>"));
  assert.equal(s.filter(t => t === "money").length, 1);
});

test("param values text and source usage", () => {
  assert.deepEqual(textToValues(" 7d, 30d,,90d "), ["7d", "30d", "90d"]);
  assert.equal(valuesToText(["7d", "30d"]), "7d, 30d");
  const page = { layout: { ref: "layout/grid@1.0.0", children: { a: { data: { source: "sales.total" } }, b: { children: [{ data: { source: "tasks.mine" } }] } } } };
  assert.deepEqual(sourcesUsedIn(page), ["sales.total", "tasks.mine"]);
  assert.ok(SOURCE_NAME.test("sales.by_region") && !SOURCE_NAME.test("Sales"));
});

test("component names, versions and new entry", () => {
  assert.ok(COMPONENT_NAME.test("kpi/delta") && !COMPONENT_NAME.test("kpi") && !COMPONENT_NAME.test("Kpi/x"));
  assert.equal(pascalName("kpi/my-delta"), serverPascal("kpi/my-delta"));
  assert.deepEqual(newComponentEntry("kpi/delta").versions, { "1.0.0": { impl: "./KpiDelta.jsx" } });
  assert.equal(latestVersion({ "1.0.0": {}, "1.10.0": {}, "1.9.0": {} }), "1.10.0");
  assert.equal(nextVersion({ "1.0.0": {} }), "1.1.0");
  assert.equal(nextVersion({}), "1.0.0");
});
