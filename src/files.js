import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse } from "yaml";
import { toYaml, writeYaml, appendVersion } from "./yaml-write.js";
export { toYaml };
import { loadProject, listPages, listOverrides, exists, forgetYaml } from "./loader.js";
import { validateTree, validateManifest } from "./validator.js";
import { clearResolveCache } from "./resolver.js";
import { applyOverride } from "./overrides.js";

// The YAML files of a project, read and written as plain objects; every write is versioned
// under .history/files/<name with / as __>/NNNN.json with the previous and the new content.
const FIXED = { manifest: "manifest.yaml", tokens: "tokens.yaml", "data-catalog": "data-catalog.yaml", "components/registry": "components/registry.yaml" };
const SLUG = /^[a-z0-9-]+$/;
const msg = e => typeof e === "string" ? e : `${e.path}: ${e.message}`;

export function isProjectFile(name) {
  if (typeof name !== "string") return false;
  if (FIXED[name]) return true;
  const [dir, slug, extra] = name.split("/");
  return (dir === "pages" || dir === "overrides") && extra === undefined && SLUG.test(slug ?? "");
}
const pathOf = (root, name) => {
  if (!isProjectFile(name)) throw new Error(`not a project file: ${name}`);
  return join(root, FIXED[name] ?? `${name}.yaml`);
};
const historyDir = (root, name) => join(root, ".history", "files", name.replace("/", "__"));

export async function readProjectFile(root, name) {
  const p = pathOf(root, name);
  if (!(await exists(p))) return null;
  return parse(await readFile(p, "utf8")) ?? null;
}

async function validateFile(root, name, value) {
  if (name === "tokens") return [];
  if (!value || typeof value !== "object") return [`${name}: content must be an object`];
  const project = await loadProject(root);
  const pages = await listPages(root);
  if (name === "manifest") return validateManifest(value, pages).map(msg);
  if (name.startsWith("pages/")) {
    if (!value.layout) return [`${name}: layout is required`];
    const errors = validateTree(value.layout, project).map(msg);
    // the overrides extending this page must still apply: a renamed child would break them silently
    for (const ov of await listOverrides(root)) {
      const o = await readProjectFile(root, `overrides/${ov}`);
      if (!o || (o.extends && o.extends !== name.slice(6))) continue;
      const r = applyOverride(value.layout, { name: ov, ...o });
      for (const e of [...r.errors, ...validateTree(r.tree, project, ov.startsWith("role-") ? { role: ov.slice(5) } : {})]) errors.push(`overrides/${ov}: ${msg(e)}`);
    }
    return errors;
  }
  if (name.startsWith("overrides/")) {
    // same check as the proposals gate; a role override is validated for its role, a user override with no role
    const ov = name.slice(10);
    if (!value.extends) return ["override.extends is required"];
    const page = await readProjectFile(root, `pages/${value.extends}`);
    if (!page) return [`page "${value.extends}" not found`];
    const r = applyOverride(page.layout, { name: ov, ...value });
    return [...r.errors, ...validateTree(r.tree, project, ov.startsWith("role-") ? { role: ov.slice(5) } : {})].map(msg);
  }
  // registry or catalog: every page must still validate against the new version
  const next = { ...project, ...(name === "data-catalog" ? { catalog: value } : { registry: value }) };
  const errors = [];
  for (const page of pages) {
    const doc = await readProjectFile(root, `pages/${page}`);
    for (const e of validateTree(doc?.layout, next)) errors.push(`pages/${page} ${msg(e)}`);
  }
  return errors;
}

async function record(root, name, before, after, { author = "studio", why = "" } = {}) {
  return appendVersion(historyDir(root, name), version => ({ version, at: new Date().toISOString(), author, why, before, after }));
}

async function put(root, name, value) {
  const p = pathOf(root, name);
  if (value === null) await rm(p, { force: true });
  else { await mkdir(dirname(p), { recursive: true }); await writeYaml(p, value); }
  forgetYaml(p); clearResolveCache();
}

export async function writeProjectFile(root, name, value, { author, why, skipValidation = false } = {}) {
  if (!isProjectFile(name)) return { ok: false, errors: [`not a project file: ${name}`] };
  const errors = skipValidation ? [] : await validateFile(root, name, value);
  if (errors.length) return { ok: false, errors };
  const before = await readProjectFile(root, name);
  await put(root, name, value);
  return { ok: true, entry: await record(root, name, before, value, { author, why }) };
}

export async function deleteProjectFile(root, name, { author, why = "deleted" } = {}) {
  if (!isProjectFile(name) || !/^(pages|overrides)\//.test(name)) return { ok: false, errors: [`${name} cannot be deleted`] };
  const before = await readProjectFile(root, name);
  if (before === null) return { ok: false, errors: [`${name} does not exist`] };
  if (name.startsWith("pages/") && (await loadProject(root)).manifest.home === name.slice(6))
    return { ok: false, errors: [`${name.slice(6)} is the home page`] };
  await put(root, name, null);
  return { ok: true, entry: await record(root, name, before, null, { author, why }) };
}

export async function listFileHistory(root, name) {
  if (!isProjectFile(name)) return [];
  const dir = historyDir(root, name);
  let files = []; try { files = (await readdir(dir)).filter(f => f.endsWith(".json")); } catch { return []; }
  const all = await Promise.all(files.map(async f => JSON.parse(await readFile(join(dir, f), "utf8"))));
  return all.sort((a, b) => b.version - a.version);
}

// Restores the content before the latest version; the restore itself is a new version.
export async function undoFile(root, name, { author } = {}) {
  const [last] = await listFileHistory(root, name);
  if (!last) return { ok: false, errors: [`${name} has no history`] };
  const current = await readProjectFile(root, name);
  await put(root, name, last.before);
  return { ok: true, value: last.before, entry: await record(root, name, current, last.before, { author, why: "undo" }) };
}

// Adds a stub implementation to data/sources.mjs, before the closing `};` of the default export.
export async function scaffoldSource(root, name) {
  const p = join(root, "data", "sources.mjs");
  let src = (await exists(p)) ? await readFile(p, "utf8") : "export default {\n};\n";
  if (src.includes(JSON.stringify(name))) return { created: false, path: p };
  const at = src.lastIndexOf("};");
  if (at < 0) throw new Error("data/sources.mjs: cannot find the end of the default export");
  const stub = `  ${JSON.stringify(name)}: async (params, { user, role }) => { /* TODO: query */ return null; },\n`;
  src = src.slice(0, at) + stub + src.slice(at);
  await mkdir(dirname(p), { recursive: true }); await writeFile(p, src);
  clearResolveCache();
  return { created: true, path: p };
}

export const pascalName = name => String(name).split(/[^a-zA-Z0-9]+/).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join("");

// Creates components/<PascalName>.jsx reading the declared props; never overwrites.
export async function scaffoldComponent(root, name, { props = {}, container = false } = {}) {
  const file = `${pascalName(name)}.jsx`, p = join(root, "components", file);
  if (await exists(p)) return { created: false, path: p, impl: `./${file}` };
  const keys = Object.keys(props ?? {}).filter(k => /^[A-Za-z_$][\w$]*$/.test(k));
  const read = keys.length ? `  const { ${keys.join(", ")} } = props;\n` : "";
  const show = keys.map(k => `      <div><strong>${k}</strong>: {String(${k} ?? "")}</div>\n`).join("");
  const src = `// ${name}: generated by pagetailor studio, edit freely.
export default function ${pascalName(name)}({ props, children }) {
${read}  return (
    <div style={{ padding: "var(--pt-spacing-md)", border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)" }}>
${show}${container ? "      {children}\n" : "      {props.data !== undefined && <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(props.data, null, 2)}</pre>}\n"}    </div>
  );
}
`;
  await mkdir(dirname(p), { recursive: true }); await writeFile(p, src);
  return { created: true, path: p, impl: `./${file}` };
}

export async function readProject(root) {
  const [project, pages, overrides] = await Promise.all([loadProject(root), listPages(root), listOverrides(root)]);
  return { manifest: project.manifest, tokens: project.tokens, catalog: project.catalog, registry: project.registry, pages, overrides };
}
