import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProject, loadPage, loadOverrides } from "./loader.js";
import { applyOverride } from "./overrides.js";
import { validateTree } from "./validator.js";
import { commitOverride, listHistory } from "./history.js";

// Own user overrides apply at once; role overrides go pending until a page owner approves.
const file = (root, name, v) => join(root, ".history", name, `${String(v).padStart(4, "0")}.json`);
const msg = e => typeof e === "string" ? e : `${e.path}: ${e.message}`;

async function gate(root, name, override, role) {
  if (!override?.extends) return ["override.extends is required"];
  const project = await loadProject(root);
  let page; try { page = await loadPage(root, override.extends); } catch { return [`page "${override.extends}" not found`]; }
  const target = name.startsWith("role-") ? name.slice(5) : role ?? null;
  let tree = page.layout;
  if (name.startsWith("user-") && role) for (const ov of await loadOverrides(root, override.extends, null, role)) tree = applyOverride(tree, ov).tree;
  const r = applyOverride(tree, { name, ...override });
  return [...r.errors, ...validateTree(r.tree, project, { role: target })].map(msg);
}

async function pendingEntry(root, name, version, approverRole) {
  const entry = (await listHistory(root, name)).find(e => e.version === version);
  if (!entry || entry.status !== "pending") return { errors: [`${name} v${version} is not pending`] };
  const page = entry.override?.extends;
  const owners = [].concat((await loadProject(root)).manifest.owners?.[page] ?? []);
  if (!owners.includes(approverRole)) return { errors: [`role ${approverRole ?? "none"} cannot approve changes to page ${page}`] };
  return { entry };
}
const mark = (root, name, entry, extra) => writeFile(file(root, name, entry.version), JSON.stringify({ ...entry, ...extra }, null, 2));

export async function propose(root, { name, override, author, role }) {
  const errors = await gate(root, name, override, role);
  if (errors.length) return { ok: false, errors };
  if (name.startsWith("user-") && author === name.slice(5)) return { ok: true, entry: await commitOverride(root, name, override, { author }) };
  const entry = await commitOverride(root, name, override, { author, status: "pending" });
  if (role) { entry.role = role; await mark(root, name, entry, {}); }
  return { ok: true, entry, pending: true };
}

export async function listPending(root) {
  let names = []; try { names = await readdir(join(root, ".history")); } catch {}
  const all = (await Promise.all(names.map(async name => (await listHistory(root, name)).map(e => ({ ...e, name }))))).flat();
  return all.filter(e => e.status === "pending").sort((a, b) => b.at.localeCompare(a.at) || b.version - a.version);
}

export async function approve(root, { name, version, approver, approverRole }) {
  const { entry, errors } = await pendingEntry(root, name, version, approverRole);
  if (errors) return { ok: false, errors };
  const gateErrors = await gate(root, name, entry.override, entry.role);
  if (gateErrors.length) return { ok: false, errors: gateErrors };
  const applied = await commitOverride(root, name, entry.override, { author: approver });
  const out = { ...applied, approvedFrom: version };
  await writeFile(file(root, name, applied.version), JSON.stringify(out, null, 2));
  await mark(root, name, entry, { status: "approved" });
  return { ok: true, entry: out };
}

export async function reject(root, { name, version, approver, approverRole, reason }) {
  const { entry, errors } = await pendingEntry(root, name, version, approverRole);
  if (errors) return { ok: false, errors };
  const out = { ...entry, status: "rejected", reason, rejectedBy: approver };
  await mark(root, name, entry, out);
  return { ok: true, entry: out };
}
