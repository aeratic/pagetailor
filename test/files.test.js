import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { transform } from "esbuild";
import { tempProject } from "./helpers.js";
import { readProjectFile, writeProjectFile, deleteProjectFile, listFileHistory, undoFile, scaffoldSource, scaffoldComponent, isProjectFile } from "../src/files.js";
import { loadSources } from "../src/loader.js";

test("allowlist of project file names", () => {
  for (const n of ["manifest", "tokens", "data-catalog", "components/registry", "pages/home", "overrides/user-giulia"]) assert.ok(isProjectFile(n), n);
  for (const n of ["../x", "pages/../manifest", "pages/Home", "pages/a/b", "components/Card", "secrets", "pages/"]) assert.ok(!isProjectFile(n), n);
});

test("write, history, undo, delete", async () => {
  const { root, cleanup } = await tempProject();
  try {
    const m = await readProjectFile(root, "manifest");
    assert.equal(m.home, "home");
    const r = await writeProjectFile(root, "manifest", { ...m, roles: [...m.roles, "sales"] }, { author: "ann", why: "add sales" });
    assert.equal(r.ok, true); assert.equal(r.entry.version, 1);
    assert.deepEqual((await readProjectFile(root, "manifest")).roles.at(-1), "sales");
    const h = await listFileHistory(root, "manifest");
    assert.equal(h.length, 1); assert.equal(h[0].why, "add sales"); assert.equal(h[0].author, "ann");
    assert.deepEqual(h[0].before.roles, m.roles); assert.ok(h[0].after.roles.includes("sales"));
    assert.ok((await readdir(join(root, ".history", "files"))).includes("manifest"));
    const u = await undoFile(root, "manifest");
    assert.equal(u.ok, true); assert.deepEqual((await readProjectFile(root, "manifest")).roles, m.roles);
    const h2 = await listFileHistory(root, "manifest");
    assert.equal(h2[0].version, 2); assert.equal(h2[0].why, "undo");

    const page = { page: "extra", layout: { ref: "layout/stack@1.0.0" } };
    assert.equal((await writeProjectFile(root, "pages/extra", page)).ok, true);
    assert.equal((await writeProjectFile(root, "manifest", { ...m, pages: [...m.pages, "extra"] })).ok, true);
    assert.equal((await deleteProjectFile(root, "pages/home")).ok, false);
    assert.equal((await deleteProjectFile(root, "manifest")).ok, false);
    const d = await deleteProjectFile(root, "pages/extra");
    assert.equal(d.ok, true); assert.equal(d.entry.after, null);
    assert.equal(await readProjectFile(root, "pages/extra"), null);
    assert.equal((await undoFile(root, "pages/extra")).ok, true);
    assert.deepEqual(await readProjectFile(root, "pages/extra"), page);
  } finally { await cleanup(); }
});

test("validation refuses bad writes and writes nothing", async () => {
  const { root, cleanup } = await tempProject();
  try {
    const m = await readProjectFile(root, "manifest");
    const bad = await writeProjectFile(root, "manifest", { ...m, owners: { home: ["ghost"] } });
    assert.equal(bad.ok, false); assert.match(bad.errors.join(), /role "ghost"/);
    assert.deepEqual(await readProjectFile(root, "manifest"), m);
    assert.deepEqual(await listFileHistory(root, "manifest"), []);

    const reg = await readProjectFile(root, "components/registry");
    delete reg["kpi/number"];
    const r = await writeProjectFile(root, "components/registry", reg);
    assert.equal(r.ok, false); assert.match(r.errors.join(), /pages\/home .*unknown component "kpi\/number"/);

    const cat = await readProjectFile(root, "data-catalog");
    delete cat["sales.total"];
    const c = await writeProjectFile(root, "data-catalog", cat);
    assert.equal(c.ok, false); assert.match(c.errors.join(), /unknown data source "sales.total"/);
    const cat2 = await readProjectFile(root, "data-catalog");
    delete cat2["stock.levels"];
    assert.equal((await writeProjectFile(root, "data-catalog", cat2)).ok, true);

    const p = await writeProjectFile(root, "pages/home", { page: "home", layout: { ref: "nope/x@1.0.0" } });
    assert.equal(p.ok, false);
    const o = await writeProjectFile(root, "overrides/user-giulia", { extends: "home", patches: [{ op: "remove", target: "missing" }] });
    assert.equal(o.ok, false); assert.match(o.errors.join(), /not found/);
    assert.equal((await writeProjectFile(root, "overrides/user-giulia", { extends: "home", patches: [{ op: "remove", target: "todo" }, { op: "set-areas", target: "layout/grid", areas: "chart chart\ntable kpi\n" }] })).ok, true);
  } finally { await cleanup(); }
});

test("multiline areas are written as literal blocks", async () => {
  const { root, cleanup } = await tempProject();
  try {
    const home = await readProjectFile(root, "pages/home");
    assert.equal((await writeProjectFile(root, "pages/home", home)).ok, true);
    const text = await readFile(join(root, "pages", "home.yaml"), "utf8");
    assert.match(text, /areas: \|\n\s+chart\s+chart\n/);
    assert.deepEqual(await readProjectFile(root, "pages/home"), home);
  } finally { await cleanup(); }
});

test("scaffoldSource and scaffoldComponent are idempotent", async () => {
  const { root, cleanup } = await tempProject();
  try {
    assert.equal((await scaffoldSource(root, "orders.open")).created, true);
    const once = await readFile(join(root, "data", "sources.mjs"), "utf8");
    assert.equal((await scaffoldSource(root, "orders.open")).created, false);
    assert.equal((await scaffoldSource(root, "sales.total")).created, false);
    assert.equal(await readFile(join(root, "data", "sources.mjs"), "utf8"), once);
    const sources = await loadSources(root);
    assert.equal(typeof sources["orders.open"], "function"); assert.equal(await sources["orders.open"]({}, {}), null);
    assert.equal(typeof sources["sales.total"], "function");

    const c = await scaffoldComponent(root, "charts/bar", { props: { title: "string?", max: "number" } });
    assert.equal(c.created, true); assert.equal(c.impl, "./ChartsBar.jsx");
    const src = await readFile(c.path, "utf8");
    assert.match(src, /export default function ChartsBar/); assert.match(src, /const \{ title, max \} = props/);
    await transform(src, { loader: "jsx", jsx: "automatic" }); // parses
    assert.equal((await scaffoldComponent(root, "charts/bar", { props: {} })).created, false);
    assert.equal(await readFile(c.path, "utf8"), src);
    const k = await scaffoldComponent(root, "layout/box", { container: true });
    assert.match(await readFile(k.path, "utf8"), /\{children\}/);
  } finally { await cleanup(); }
});
