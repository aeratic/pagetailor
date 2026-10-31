import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeAt, updateAt, acceptedSources, migrateProps, appendAreaRow, removeAreaName, renameAreaName, newNode, refOptions } from "../src/studio/tabs/PagesTab.jsx";

const tree = { ref: "layout/card@1.0.0", children: [{ ref: "layout/grid@1.0.0", props: { areas: "a b\n" }, children: { a: { ref: "kpi/number@1.0.0" }, b: { ref: "text/block@1.0.0" } } }] };

test("nodeAt addresses array and named children", () => {
  assert.equal(nodeAt(tree, []), tree);
  assert.equal(nodeAt(tree, [0, "a"]).ref, "kpi/number@1.0.0");
  assert.equal(nodeAt(tree, [0, "zz"]), undefined);
  assert.equal(nodeAt(tree, [3, "a"]), undefined);
});

test("updateAt copies and leaves the original untouched", () => {
  const t = updateAt(tree, [0, "b"], n => { n.props = { content: "hi" }; });
  assert.deepEqual(nodeAt(t, [0, "b"]).props, { content: "hi" });
  assert.equal(nodeAt(tree, [0, "b"]).props, undefined);
  assert.equal(updateAt(tree, [], () => ({ ref: "x@1" })).ref, "x@1");
  assert.equal(updateAt(tree, [0, "a"], () => ({ ref: "y@1" })).children[0].children.a.ref, "y@1");
});

test("acceptedSources filters by type and skips containers", () => {
  const catalog = { "s.total": { returns: "money" }, "s.rows": { returns: "table<row>" }, "t.list": { returns: "list<task>" } };
  assert.deepEqual(acceptedSources(catalog, { accepts: "money" }), ["s.total"]);
  assert.deepEqual(acceptedSources(catalog, { accepts: "table<any>" }), ["s.rows"]);
  assert.deepEqual(acceptedSources(catalog, { accepts: "any" }), ["s.total", "s.rows", "t.list"]);
  assert.deepEqual(acceptedSources(catalog, { container: true }), []);
  assert.deepEqual(acceptedSources(catalog, {}), []);
});

test("migrateProps keeps only props of the new schema", () => {
  assert.deepEqual(migrateProps({ title: "x", gap: "4" }, { title: "string?", gap: "string?" }, { title: "string?" }), { title: "x" });
  assert.deepEqual(migrateProps({ a: 1 }, {}, undefined), { a: 1 });
  assert.deepEqual(migrateProps(undefined, undefined, { a: "string" }), {});
});

test("appendAreaRow spans all columns", () => {
  assert.equal(appendAreaRow("chart chart\ntable kpi\n", "todo"), "chart chart\ntable kpi\ntodo todo\n");
  assert.equal(appendAreaRow("", "a"), "a\n");
  assert.equal(appendAreaRow(undefined, "a"), "a\n");
  assert.equal(appendAreaRow("a .  .\nb\n", "c"), "a . .\nb\nc c c\n");
});

test("removeAreaName empties cells and drops empty rows", () => {
  assert.equal(removeAreaName("chart chart\ntable kpi\ntable todo\n", "table"), "chart chart\n. kpi\n. todo\n");
  assert.equal(removeAreaName("a a\nb .\n", "b"), "a a\n");
  assert.equal(removeAreaName("a\n", "a"), "");
  assert.equal(removeAreaName("", "a"), "");
});

test("renameAreaName renames every cell and keeps dots", () => {
  assert.equal(renameAreaName("a a\n. a\nb b\n", "a", "z"), "z z\n. z\nb b\n");
  assert.equal(renameAreaName("ab a\n", "a", "c"), "ab c\n");
});

test("newNode fills required props with defaults", () => {
  assert.deepEqual(newNode("layout/grid", "1.0.0", { container: true, props: { areas: "text" } }), { ref: "layout/grid@1.0.0", props: { areas: ".\n" }, children: {} });
  assert.deepEqual(newNode("layout/stack", "1.0.0", { container: true, props: { gap: "string?" } }), { ref: "layout/stack@1.0.0", children: [] });
  assert.deepEqual(newNode("x/y", "2.0.0", { props: { s: "string", n: "number", b: "boolean", e: "enum[up,down]", l: "string[]", m: "number[]?", t: "text" } }),
    { ref: "x/y@2.0.0", props: { s: "", n: 0, b: false, e: "up", l: [], t: "" } });
  assert.deepEqual(newNode("x/y", "1.0.0", undefined), { ref: "x/y@1.0.0" });
});

test("refOptions lists name@version", () => {
  assert.deepEqual(refOptions({ a: { versions: { "1.0.0": {}, "2.0.0": {} } }, b: {} }), ["a@1.0.0", "a@2.0.0"]);
});
