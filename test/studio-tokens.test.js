import { test } from "node:test";
import assert from "node:assert/strict";
import { setPath, isHex } from "../src/studio/tabs/TokensTab.jsx";

test("setPath sets nested values immutably", () => {
  const a = { color: { primary: "#000" }, radius: 8 };
  const b = setPath(a, ["color", "primary"], "#fff");
  assert.equal(b.color.primary, "#fff");
  assert.equal(a.color.primary, "#000");
  assert.notEqual(a.color, b.color);
  assert.equal(b.radius, 8);
  assert.deepEqual(setPath({}, "font.size", 15), { font: { size: 15 } });
  assert.deepEqual(setPath(a, ["radius"], 4).radius, 4);
});

test("isHex accepts #rgb and #rrggbb only", () => {
  for (const s of ["#fff", "#1D9E75", "#abcdef"]) assert.ok(isHex(s), s);
  for (const s of ["fff", "#ffff", "#ggg", "", null, 12, "#1D9E7"]) assert.ok(!isHex(s), String(s));
});
