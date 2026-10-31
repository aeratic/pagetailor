import { loadProject, loadPage, loadOverrides, loadSources } from "./loader.js";
import { validateTree } from "./validator.js";
import { applyOverride } from "./overrides.js";
import { stat } from "node:fs/promises";
import { join } from "node:path";

// in-memory cache: data sources are not called again while the project files are unchanged
const cache = new Map();
export function clearResolveCache() { cache.clear(); }
const mtime = p => stat(p).then(s => s.mtimeMs, () => 0);
const fingerprint = (root, page, user, role) => Promise.all([
  "manifest.yaml", "data-catalog.yaml", join("components", "registry.yaml"), join("pages", `${page}.yaml`),
  join("overrides", `role-${role}.yaml`), join("overrides", `user-${user}.yaml`), join("data", "sources.mjs"),
].map(f => mtime(join(root, f)))).then(a => Math.max(...a));

// YAML page + overrides + data  ->  json-render flat spec { root, elements, state }
// opts.tree: an in-memory layout (e.g. an agent answer), no page file, no overrides, no cache
export async function resolve(root, page, { user, role, sources, tree, fresh = false, maxAge = 0 } = {}) {
  if (tree) return build(root, page, { user, role, sources, tree });
  const key = `${root}|${page}|${user}|${role}`, fp = await fingerprint(root, page, user, role);
  const hit = cache.get(key);
  if (!fresh && hit && hit.fp === fp && (!maxAge || Date.now() - hit.at < maxAge)) return hit.result;
  const result = await build(root, page, { user, role, sources });
  cache.set(key, { fp, at: Date.now(), result });
  return result;
}

async function build(root, page, { user, role, sources, tree: given }) {
  const project = await loadProject(root);
  const fetchers = sources ?? await loadSources(root);
  let tree = given ?? (await loadPage(root, page)).layout;
  const errors = [];
  if (!given) for (const ov of await loadOverrides(root, page, user, role)) {
    const r = applyOverride(tree, ov); tree = r.tree; errors.push(...r.errors);
  }
  errors.push(...validateTree(tree, project, { role: role ?? null }));
  const byPath = new Map(); for (const e of errors) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e.message]);

  const elements = {}, state = { data: {}, user: { id: user ?? null, role: role ?? null } };
  let n = 0;
  const label = n => n?.ref ? n.ref.split("@")[0] : null;
  // __pt maps an element back to its YAML target: own name (child name or component name) and the parent's.
  const walk = async (node, path, name = label(node), container = null) => {
    const id = `e${n++}`;
    const bad = byPath.get(path);
    if (bad) { elements[id] = { type: "pt/fallback", props: { reason: bad.join("; ") } }; return id; }
    const props = { ...(node.props ?? {}), __pt: { path, name, container } };
    if (node.data?.source) {
      const key = `${node.data.source}${node.data.params ? ":" + JSON.stringify(node.data.params) : ""}`.replace(/[^\w]/g, "_");
      if (!(key in state.data)) {
        const fn = fetchers[node.data.source];
        state.data[key] = fn ? await fn(node.data.params ?? {}, { user, role }) : null;
      }
      props.data = { $state: `/data/${key}` };
    }
    const el = { type: node.ref, props };
    if (node.children) {
      const named = !Array.isArray(node.children);
      const entries = named ? Object.entries(node.children) : node.children.map((c, i) => [i, c]);
      if (named) props.names = entries.map(([k]) => k);
      el.children = [];
      for (const [i, [k, c]] of entries.entries()) el.children.push(await walk(c, `${path}/${i}`, named ? k : label(c), name));
    }
    elements[id] = el; return id;
  };
  const rootId = await walk(tree, "root");
  return { spec: { root: rootId, elements, state }, errors, tokens: project.tokens, manifest: project.manifest };
}
