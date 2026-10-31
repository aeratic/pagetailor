import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, parseDocument, visit } from "yaml";

// Serialise a plain object as YAML. When the previous text of the file is given, top-level keys are
// set on the parsed document so the file's comments and key order survive the rewrite.
export function toYaml(value, previous) {
  let doc;
  if (typeof previous === "string" && previous.trim()) {
    doc = parseDocument(previous);
    if (doc.errors.length || !doc.contents || doc.contents.items === undefined) doc = new Document(value);
    else {
      for (const key of Object.keys(value)) {
        const old = doc.get(key, true), node = doc.createNode(value[key]);
        if (old && typeof old === "object") for (const c of ["comment", "commentBefore", "spaceBefore", "flow"]) if (old[c] !== undefined) node[c] = old[c];
        doc.set(key, node);
      }
      for (const item of [...doc.contents.items]) { const k = item.key?.value ?? item.key; if (!(k in value)) doc.delete(k); }
    }
  } else doc = new Document(value);
  visit(doc, { Scalar(_, node) { if (typeof node.value === "string" && node.value.includes("\n")) node.type = "BLOCK_LITERAL"; } });
  return doc.toString();
}

// Rewrite a YAML file keeping its comments; a missing file is created.
export async function writeYaml(path, value) {
  let previous; try { previous = await readFile(path, "utf8"); } catch {}
  await writeFile(path, toYaml(value, previous));
}

export const pad = n => String(n).padStart(4, "0");

// Append a numbered JSON version to dir: the number is max+1 and the file is created exclusively,
// so two concurrent writers never share a version (the loser retries with the next number).
export async function appendVersion(dir, build) {
  await mkdir(dir, { recursive: true });
  for (let tries = 0; tries < 20; tries++) {
    const nums = (await readdir(dir)).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.slice(0, -5)));
    const version = (nums.length ? Math.max(...nums) : 0) + 1;
    const entry = build(version);
    try { await writeFile(join(dir, `${pad(version)}.json`), JSON.stringify(entry, null, 2), { flag: "wx" }); return entry; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  throw new Error(`${dir}: could not allocate a version number`);
}
