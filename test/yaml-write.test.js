import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { toYaml, writeYaml, appendVersion } from "../src/yaml-write.js";
import { tempProject } from "./helpers.js";
import { keepAnswer } from "../src/agent.js";
import { writeProjectFile } from "../src/files.js";
import { commitOverride } from "../src/history.js";
import { propose, approve } from "../src/proposals.js";

test("toYaml keeps comments and key order of the previous text, drops removed keys", () => {
  const prev = "# header\napp: x   # inline\nhome: home\npages: [home]\nold: 1\n";
  const out = toYaml({ app: "y", home: "home", pages: ["home", "two"], areas: "a b\nc d\n" }, prev);
  assert.match(out, /^# header\n/); assert.match(out, /app: y\s+# inline/); assert.doesNotMatch(out, /old:/);
  assert.match(out, /areas: \|/);
  assert.deepEqual(parse(out), { app: "y", home: "home", pages: ["home", "two"], areas: "a b\nc d\n" });
  assert.equal(toYaml({ a: 1 }, "garbage: [").trim(), "a: 1");
});

test("keepAnswer and studio writes preserve manifest comments", async () => {
  const p = await tempProject();
  try {
    const m = join(p.root, "manifest.yaml");
    assert.match(await readFile(m, "utf8"), /# roles that may approve/);
    const tree = { ref: "layout/stack@1.0.0", children: [{ ref: "text/block@1.0.0", props: { content: "hi" } }] };
    await keepAnswer(p.root, { user: "giulia", role: "marketing", title: "Note", tree });
    let txt = await readFile(m, "utf8");
    assert.match(txt, /# roles that may approve/); assert.deepEqual(parse(txt).pages, ["home", "note"]);
    const r = await writeProjectFile(p.root, "manifest", { ...parse(txt), app: "renamed" });
    assert.equal(r.ok, true, JSON.stringify(r));
    txt = await readFile(m, "utf8");
    assert.match(txt, /# roles that may approve/); assert.equal(parse(txt).app, "renamed");
    const ov = join(p.root, "overrides", "user-giulia.yaml");
    await writeFile(ov, "# giulia\n" + await readFile(ov, "utf8"));
    await commitOverride(p.root, "user-giulia", { extends: "home", why: "w", patches: [] });
    assert.match(await readFile(ov, "utf8"), /^# giulia\n/);
  } finally { await p.cleanup(); }
});

test("appendVersion: concurrent writers get distinct consecutive versions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-ver-"));
  try {
    await writeFile(join(dir, "0003.json"), "{}"); // gaps or stray files do not matter: next is max+1
    const entries = await Promise.all(Array.from({ length: 12 }, (_, i) => appendVersion(dir, v => ({ version: v, i }))));
    const versions = entries.map(e => e.version).sort((a, b) => a - b);
    assert.deepEqual(versions, Array.from({ length: 12 }, (_, i) => i + 4));
    assert.equal((await readdir(dir)).length, 13);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("proposals refuse roles that are not in the manifest", async () => {
  const p = await tempProject();
  try {
    const override = { extends: "home", patches: [{ op: "set-props", target: "kpi", props: { label: "x" } }] };
    let r = await propose(p.root, { name: "user-giulia", author: "giulia", role: "ceo", override });
    assert.equal(r.ok, false); assert.match(r.errors.join(), /unknown role "ceo"/);
    r = await propose(p.root, { name: "role-ceo", author: "ann", override });
    assert.equal(r.ok, false); assert.match(r.errors.join(), /unknown role "ceo"/);
    r = await propose(p.root, { name: "role-marketing", author: "ann", override });
    assert.equal(r.pending, true);
    const a = await approve(p.root, { name: "role-marketing", version: r.entry.version, approver: "x", approverRole: "ghost" });
    assert.equal(a.ok, false); assert.match(a.errors.join(), /unknown role "ghost"/);
    assert.equal((await approve(p.root, { name: "role-marketing", version: r.entry.version, approver: "x", approverRole: "admin" })).ok, true);
  } finally { await p.cleanup(); }
});
