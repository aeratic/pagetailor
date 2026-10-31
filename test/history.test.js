import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { commitOverride, listHistory, rollback } from "../src/history.js";
import { tempProject } from "./helpers.js";

let p; before(async () => { p = await tempProject(); }); after(() => p.cleanup());
const ov = (why) => ({ extends: "home", why, patches: [{ op: "remove", target: "kpi" }] });

test("commit numbers versions and rewrites the override file", async () => {
  const a = await commitOverride(p.root, "user-ann", ov("one"), { author: "ann" });
  const b = await commitOverride(p.root, "user-ann", ov("two"));
  assert.equal(a.version, 1); assert.equal(b.version, 2); assert.equal(a.author, "ann");
  assert.equal(parse(await readFile(join(p.root, "overrides", "user-ann.yaml"), "utf8")).why, "two");
});
test("pending commit is recorded but does not touch the file", async () => {
  await commitOverride(p.root, "user-ann", ov("proposal"), { status: "pending" });
  assert.equal(parse(await readFile(join(p.root, "overrides", "user-ann.yaml"), "utf8")).why, "two");
  assert.equal((await listHistory(p.root, "user-ann")).at(-1).status, "pending");
});
test("rollback creates a new version from an old one, keeps all versions", async () => {
  const r = await rollback(p.root, "user-ann", 1);
  assert.equal(r.version, 4); assert.match(r.override.why, /rollback to v1: one/);
  assert.equal(parse(await readFile(join(p.root, "overrides", "user-ann.yaml"), "utf8")).why, "rollback to v1: one");
  assert.equal((await listHistory(p.root, "user-ann")).length, 4);
});
test("history of unknown name is empty", async () => assert.deepEqual(await listHistory(p.root, "nobody"), []));
