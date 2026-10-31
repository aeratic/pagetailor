import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeYaml, appendVersion, pad } from "./yaml-write.js";

// Every write to an override is a new numbered version under .history/<name>/NNNN.json.
// The current override file is rewritten from the version being committed.
const dirOf = (root, name) => join(root, ".history", name);

export async function commitOverride(root, name, override, { author = "system", status = "applied" } = {}) {
  const entry = await appendVersion(dirOf(root, name), version => ({ version, at: new Date().toISOString(), author, status, override }));
  if (status === "applied") await writeYaml(join(root, "overrides", `${name}.yaml`), override);
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
