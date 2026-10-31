import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { tempProject } from "./helpers.js";
import { loadProject, listHistory } from "../src/index.js";
import { describeCatalog, describePage, buildAgentPrompt, parseAgentReply, runAgent } from "../src/agent.js";

const fake = (...replies) => { const calls = []; const fn = async m => { calls.push(m); return replies[calls.length - 1]; }; fn.calls = calls; return fn; };

test("describeCatalog lists components with props and hides sources the role cannot read", async () => {
  const p = await tempProject();
  try {
    const project = await loadProject(p.root);
    const mag = describeCatalog(project, { role: "magazzino" });
    assert.match(mag, /charts\/line@1\.0\.0: .*accepts timeseries<money>; props \{ title: string\? \}/);
    assert.match(mag, /stock\.levels/); assert.match(mag, /tasks\.mine/);
    assert.doesNotMatch(mag, /analytics\.revenue|sales\.total|sales\.by_region/);
    const mk = describeCatalog(project, { role: "marketing" });
    assert.match(mk, /analytics\.revenue: .*params \{ period: 7d\|30d\|90d \}/);
    assert.doesNotMatch(mk, /stock\.levels/);
    assert.match(mk, /- set-areas: /); assert.match(mk, /- insert: /);
  } finally { await p.cleanup(); }
});

test("describePage shows giulia's layout with areas", async () => {
  const p = await tempProject();
  try {
    const d = await describePage(p.root, "home", { user: "giulia", role: "marketing" });
    assert.match(d, /layout\/grid: layout\/grid@1\.0\.0/);
    assert.match(d, /areas: "kpi    kpi\\nchart  chart\\ntable  todo\\n"/);
    assert.match(d, /kpi: kpi\/number@1\.0\.0 \(data: sales\.total\)/);
    assert.match(d, /chart: charts\/line@1\.0\.0 \(data: analytics\.revenue \{"period":"30d"\}\)/);
  } finally { await p.cleanup(); }
});

test("parseAgentReply handles fences and prose, throws on garbage", () => {
  assert.deepEqual(parseAgentReply('```json\n{"why":"x","patches":[]}\n```'), { why: "x", patches: [] });
  assert.deepEqual(parseAgentReply('Sure, here it is:\n{"refuse":"no"}\nbye'), { refuse: "no" });
  assert.throws(() => parseAgentReply("I cannot do that"), /not a JSON object/);
  assert.throws(() => parseAgentReply("{not json}"), /not a JSON object/);
});

test("buildAgentPrompt contains rules, catalog and page", async () => {
  const p = await tempProject();
  try {
    const r = await buildAgentPrompt(p.root, { page: "home", user: "giulia", role: "marketing", request: "metti il grafico in alto" });
    assert.equal(r.user, "metti il grafico in alto");
    assert.match(r.system, /"refuse"/); assert.match(r.system, /charts\/line@1\.0\.0/); assert.match(r.system, /CURRENT PAGE home/);
  } finally { await p.cleanup(); }
});

test("runAgent applies a valid patch for the own user, merged into existing patches", async () => {
  const p = await tempProject();
  try {
    const complete = fake(JSON.stringify({ why: "etichetta", patches: [{ op: "set-props", target: "kpi", props: { label: "Mese" } }] }));
    const r = await runAgent(p.root, { page: "home", user: "giulia", role: "marketing", request: "rinomina il kpi", complete });
    assert.equal(r.ok, true); assert.equal(r.attempts, 1); assert.ok(!r.proposal.pending);
    const ov = parse(await readFile(join(p.root, "overrides", "user-giulia.yaml"), "utf8"));
    assert.deepEqual(ov.patches.map(x => x.op), ["set-areas", "set-props"]);
    assert.equal(ov.why, "etichetta");
  } finally { await p.cleanup(); }
});

test("runAgent retries once with the gate errors", async () => {
  const p = await tempProject();
  try {
    const complete = fake(
      JSON.stringify({ why: "a", patches: [{ op: "set-data", target: "kpi", data: { source: "sales.nope" } }] }),
      "```json\n" + JSON.stringify({ why: "b", patches: [{ op: "set-props", target: "kpi", props: { label: "Ok" } }] }) + "\n```");
    const r = await runAgent(p.root, { page: "home", user: "giulia", role: "marketing", request: "x", complete });
    assert.equal(r.ok, true); assert.equal(r.attempts, 2);
    assert.match(complete.calls[1].user, /The previous patch was rejected: .*sales\.nope.*Fix it\./);
  } finally { await p.cleanup(); }
});

test("runAgent refuse commits nothing", async () => {
  const p = await tempProject();
  try {
    const before = await readFile(join(p.root, "overrides", "user-giulia.yaml"), "utf8");
    const r = await runAgent(p.root, { page: "home", user: "giulia", role: "marketing", request: "mostra le giacenze", complete: fake('{"refuse":"il ruolo non può leggere le giacenze"}') });
    assert.equal(r.ok, false); assert.match(r.refuse, /giacenze/);
    assert.equal(await readFile(join(p.root, "overrides", "user-giulia.yaml"), "utf8"), before);
    assert.deepEqual(await listHistory(p.root, "user-giulia"), []);
  } finally { await p.cleanup(); }
});

test("runAgent for a new user creates the override", async () => {
  const p = await tempProject();
  try {
    const complete = fake(JSON.stringify({ why: "w", patches: [{ op: "remove", target: "table" }, { op: "set-areas", target: "layout/grid", areas: "chart chart\nkpi todo\n" }] }));
    const r = await runAgent(p.root, { page: "home", user: "bob", role: "marketing", request: "togli la tabella", complete });
    assert.equal(r.ok, true, JSON.stringify(r));
    const ov = parse(await readFile(join(p.root, "overrides", "user-bob.yaml"), "utf8"));
    assert.equal(ov.extends, "home"); assert.equal(ov.patches.length, 2);
  } finally { await p.cleanup(); }
});
