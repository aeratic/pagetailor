import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { propose, listPending, approve, reject } from "../src/proposals.js";
import { listHistory } from "../src/history.js";
import { resolve } from "../src/resolver.js";
import { validateManifest } from "../src/validator.js";
import { tempProject } from "./helpers.js";

let p; before(async () => { p = await tempProject(); }); after(() => p.cleanup());
const title = t => ({ extends: "home", why: t, patches: [{ op: "set-props", target: "kpi", props: { label: t } }] });
const read = name => readFile(join(p.root, "overrides", `${name}.yaml`), "utf8").then(parse);

test("manifest owners must be known pages and roles", () => {
  const errs = validateManifest({ pages: ["home"], roles: ["admin"], owners: { home: ["boss"], nope: ["admin"] } }, ["home"]).map(e => e.message);
  assert.ok(errs.some(m => /role "boss"/.test(m))); assert.ok(errs.some(m => /page "nope"/.test(m)));
});
test("invalid proposal records nothing and lists gate errors", async () => {
  const r = await propose(p.root, { name: "role-marketing", author: "ann", override: { extends: "home", patches: [{ op: "set-data", target: "kpi", data: { source: "sales.nope" } }] } });
  assert.equal(r.ok, false); assert.match(r.errors.join("\n"), /unknown data source "sales.nope"/);
  assert.deepEqual(await listHistory(p.root, "role-marketing"), []);
});
test("own user override applies immediately", async () => {
  const r = await propose(p.root, { name: "user-ann", author: "ann", role: "marketing", override: title("mine") });
  assert.equal(r.ok, true); assert.equal(r.pending, undefined); assert.equal(r.entry.status, "applied");
  assert.equal((await read("user-ann")).why, "mine");
});
test("role override goes pending, non-owner refused, owner approves", async () => {
  const before = await read("role-magazzino");
  const r = await propose(p.root, { name: "role-magazzino", author: "ann", override: { ...before, why: "shared" } });
  assert.equal(r.pending, true); assert.equal(r.entry.status, "pending");
  assert.deepEqual(await read("role-magazzino"), before);
  const no = await approve(p.root, { name: "role-magazzino", version: r.entry.version, approver: "ann", approverRole: "marketing" });
  assert.deepEqual(no, { ok: false, errors: ["role marketing cannot approve changes to page home"] });
  const yes = await approve(p.root, { name: "role-magazzino", version: r.entry.version, approver: "boss", approverRole: "admin" });
  assert.equal(yes.ok, true); assert.equal(yes.entry.approvedFrom, r.entry.version); assert.equal(yes.entry.author, "boss");
  const h = await listHistory(p.root, "role-magazzino");
  assert.equal(h.find(e => e.version === r.entry.version).status, "approved");
  assert.equal((await read("role-magazzino")).why, "shared");
});
test("approved role override is visible in resolve", async () => {
  const r = await propose(p.root, { name: "role-admin", author: "ann", override: title("Per admin") });
  await approve(p.root, { name: "role-admin", version: r.entry.version, approver: "boss", approverRole: "admin" });
  const { spec } = await resolve(p.root, "home", { role: "admin", sources: {} });
  assert.ok(Object.values(spec.elements).some(e => e.props?.label === "Per admin"));
});
test("reject marks rejected with reason; listPending newest first", async () => {
  const a = await propose(p.root, { name: "role-marketing", author: "ann", override: title("a") });
  await new Promise(r => setTimeout(r, 5));
  const b = await propose(p.root, { name: "user-bob", author: "ann", role: "marketing", override: title("b") });
  assert.equal(b.pending, true);
  assert.deepEqual((await listPending(p.root)).map(e => e.name), ["user-bob", "role-marketing"]);
  const r = await reject(p.root, { name: "role-marketing", version: a.entry.version, approver: "boss", approverRole: "admin", reason: "no" });
  assert.equal(r.ok, true);
  const e = (await listHistory(p.root, "role-marketing")).at(-1);
  assert.equal(e.status, "rejected"); assert.equal(e.reason, "no");
  assert.deepEqual((await listPending(p.root)).map(e => e.name), ["user-bob"]);
});
test("user proposal is gated on top of its role override", async () => {
  const override = { extends: "home", patches: [{ op: "set-props", target: "kpi", props: { label: "x" } }] };
  const no = await propose(p.root, { name: "user-marco", author: "marco", role: "magazzino", override });
  assert.equal(no.ok, false); assert.match(no.errors.join("\n"), /not found/);
  assert.equal((await propose(p.root, { name: "user-marco", author: "marco", role: "marketing", override })).ok, true);
});
