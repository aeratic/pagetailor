import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

// Every write to an override is a new numbered version under .history/<name>/NNNN.json.
// The current override file is rewritten from the version being committed.
const dirOf = (root, name) => join(root, ".history", name);
const pad = n => String(n).padStart(4, "0");

export async function commitOverride(root, name, override, { author = "system", status = "applied" } = {}) {
  const dir = dirOf(root, name); await mkdir(dir, { recursive: true });
  const n = (await readdir(dir)).length + 1;
  const entry = { version: n, at: new Date().toISOString(), author, status, override };
  await writeFile(join(dir, `${pad(n)}.json`), JSON.stringify(entry, null, 2));
  if (status === "applied") await writeFile(join(root, "overrides", `${name}.yaml`), stringify(override));
  return entry;
}

export async function listHistory(root, name) {
  try { const files = (await readdir(dirOf(root, name))).sort(); return Promise.all(files.map(async f => JSON.parse(await readFile(join(dirOf(root, name), f), "utf8")))); }
  catch { return []; }
}

export async function rollback(root, name, version, { author = "system" } = {}) {
  const entry = JSON.parse(await readFile(join(dirOf(root, name), `${pad(version)}.json`), "utf8"));
  return commitOverride(root, name, { ...entry.override, why: `rollback to v${version}: ${entry.override.why ?? ""}`.trim() }, { author });
}
