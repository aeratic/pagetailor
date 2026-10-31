import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { validateSpec } from "@json-render/core";
import { tempProject } from "./helpers.js";
import { resolve, validate } from "../src/index.js";
import { runAsk, keepAnswer, pinAnswer, buildAskPrompt } from "../src/agent.js";

const fake = (...replies) => { const calls = []; const fn = async m => { calls.push(m); return replies[calls.length - 1]; }; fn.calls = calls; return fn; };
const grid = (kpiSource = "sales.total") => ({ ref: "layout/grid@1.0.0", props: { areas: "kpi chart\n" }, children: {
  kpi: { ref: "kpi/number@1.0.0", props: { label: "Mese" }, data: { source: kpiSource } },
  chart: { ref: "charts/line@1.0.0", props: { title: "Ricavi" }, data: { source: "analytics.revenue", params: { period: "7d" } } },
} });
const answer = (source) => JSON.stringify({ title: "Vendite della settimana", why: "kpi e grafico", patches: [
  { op: "insert", target: "layout/stack", node: { ref: "layout/card@1.0.0", props: { title: "Settimana" }, children: [] } },
  { op: "insert", target: "layout/card", node: grid(source) },
] });
const who = { user: "giulia", role: "marketing" };

test("buildAskPrompt shows the empty answer page and insert-only rules", async () => {
  const p = await tempProject();
  try {
    const r = await buildAskPrompt(p.root, { ...who, request: "q" });
    assert.match(r.system, /CURRENT PAGE answer/); assert.match(r.system, /"title": string/); assert.match(r.system, /"refuse"/);
  } finally { await p.cleanup(); }
});

test("runAsk composes a card + grid in memory, writes nothing", async () => {
  const p = await tempProject();
  try {
    const before = await readdir(join(p.root, "pages"));
    const r = await runAsk(p.root, { ...who, request: "come vanno le vendite?", complete: fake(answer()) });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.attempts, 1); assert.equal(r.title, "Vendite della settimana");
    assert.deepEqual(r.resolved.errors, []);
    assert.equal(validateSpec(r.resolved.spec).valid, true);
    assert.equal(Object.values(r.resolved.spec.elements).filter(e => e.type === "pt/fallback").length, 0);
    assert.deepEqual(await readdir(join(p.root, "pages")), before);
  } finally { await p.cleanup(); }
});

test("runAsk retries once after a forbidden source", async () => {
  const p = await tempProject();
  try {
    const complete = fake(answer("stock.levels"), answer());
    const r = await runAsk(p.root, { ...who, request: "x", complete });
    assert.equal(r.ok, true); assert.equal(r.attempts, 2);
    assert.match(complete.calls[1].user, /rejected: .*stock\.levels/);
  } finally { await p.cleanup(); }
});

test("runAsk refusal", async () => {
  const p = await tempProject();
  try {
    const r = await runAsk(p.root, { ...who, request: "x", complete: fake('{"refuse":"no"}') });
    assert.equal(r.ok, false); assert.equal(r.refuse, "no");
  } finally { await p.cleanup(); }
});

test("keepAnswer writes a unique page, updates the manifest, resolves", async () => {
  const p = await tempProject();
  try {
    const a = await runAsk(p.root, { ...who, request: "x", complete: fake(answer()) });
    const k1 = await keepAnswer(p.root, { ...who, title: a.title, tree: a.tree, why: a.why });
    assert.equal(k1.page, "vendite-della-settimana");
    const k2 = await keepAnswer(p.root, { ...who, title: a.title, tree: a.tree, why: a.why });
    assert.equal(k2.page, "vendite-della-settimana-2");
    const page = parse(await readFile(join(p.root, "pages", "vendite-della-settimana.yaml"), "utf8"));
    assert.equal(page.owner, "giulia"); assert.equal(page.page, k1.page); assert.deepEqual(page.layout, a.tree);
    const m = parse(await readFile(join(p.root, "manifest.yaml"), "utf8"));
    assert.deepEqual(m.pages, ["home", k1.page, k2.page]); assert.equal(m.home, "home"); assert.ok(m.owners);
    const r = await resolve(p.root, k1.page, who);
    assert.deepEqual(r.errors, []);
    assert.equal(await validate(p.dir), true);
  } finally { await p.cleanup(); }
});

test("keepAnswer refuses a forbidden source and writes nothing", async () => {
  const p = await tempProject();
  try {
    const before = await readdir(join(p.root, "pages")), man = await readFile(join(p.root, "manifest.yaml"), "utf8");
    const tree = { ref: "layout/stack@1.0.0", children: [grid("stock.levels")] };
    const r = await keepAnswer(p.root, { ...who, title: "x", tree });
    assert.equal(r.ok, false); assert.match(r.errors.join(), /stock\.levels/);
    assert.deepEqual(await readdir(join(p.root, "pages")), before);
    assert.equal(await readFile(join(p.root, "manifest.yaml"), "utf8"), man);
  } finally { await p.cleanup(); }
});

test("pinAnswer adds a full-width card at the bottom of the home grid", async () => {
  const p = await tempProject();
  try {
    const a = await runAsk(p.root, { ...who, request: "x", complete: fake(answer()) });
    const r = await pinAnswer(p.root, { ...who, title: a.title, tree: a.tree, why: a.why });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(!r.pending);
    const ov = parse(await readFile(join(p.root, "overrides", "user-giulia.yaml"), "utf8"));
    const ins = ov.patches.at(-1);
    assert.equal(ins.op, "insert"); assert.equal(ins.name, "answer-1"); assert.match(ins.area, /\nanswer-1 answer-1\n$/);
    const res = await resolve(p.root, "home", { ...who, fresh: true });
    assert.deepEqual(res.errors, []);
    const grid = Object.values(res.spec.elements).find(e => e.type === "layout/grid@1.0.0" && e.props.names.includes("todo"));
    assert.equal(grid.props.names.at(-1), "answer-1");
    assert.equal(await validate(p.dir), true);
  } finally { await p.cleanup(); }
});
