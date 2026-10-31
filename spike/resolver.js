import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
const load = (p) => parse(readFileSync(p, "utf8"));

export function loadProject(root) {
  return { catalog: load(`${root}/data-catalog.yaml`), registry: load(`${root}/registry.yaml`), root };
}

// --- validation: component exists, version exists, source exists, role ok, type ok
export function validateNode(node, ctx, path, errors) {
  const [name, version] = node.ref.split("@");
  const comp = ctx.registry[name];
  if (!comp) return errors.push(`${path}: unknown component ${name}`);
  if (!comp.versions[version]) errors.push(`${path}: ${name} has no version ${version}`);
  if (node.data?.source) {
    const src = ctx.catalog[node.data.source];
    if (!src) errors.push(`${path}: unknown source ${node.data.source}`);
    else {
      if (!src.roles.includes(ctx.role)) errors.push(`${path}: role ${ctx.role} cannot read ${node.data.source}`);
      if (comp.accepts && comp.accepts !== "any" && comp.accepts !== src.returns)
        errors.push(`${path}: ${name} accepts ${comp.accepts} but ${node.data.source} returns ${src.returns}`);
    }
  }
  const kids = node.children ? (Array.isArray(node.children) ? node.children : Object.values(node.children)) : [];
  kids.forEach((k, i) => validateNode(k, ctx, `${path}/${i}`, errors));
  return errors;
}

// --- overrides: small op vocabulary applied on the YAML tree, not on the spec
export function applyOverride(tree, override) {
  const t = structuredClone(tree);
  for (const p of override.patches) {
    const found = find(t, p.target);
    if (!found) throw new Error(`patch target not found: ${p.target}`);
    const { parent, key, node } = found;
    if (p.op === "set-areas") node.props.areas = p.areas;
    else if (p.op === "replace") parent[key] = p.with;
    else if (p.op === "remove") delete parent[key];
    else if (p.op === "set-props") Object.assign(node.props ??= {}, p.props);
    else throw new Error(`unknown op ${p.op}`);
  }
  return t;
}
function find(node, target, parent = null, key = null) {
  if (node.ref?.split("@")[0] === target || key === target) return { parent, key, node };
  const kids = node.children;
  if (!kids) return null;
  for (const [k, v] of Object.entries(kids)) { const r = find(v, target, kids, k); if (r) return r; }
  return null;
}

// --- history: every write is a new numbered version with why/author/date
export function commit(root, user, override) {
  const dir = `${root}/.history/${user}`; mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir).length + 1;
  writeFileSync(`${dir}/${String(n).padStart(4, "0")}.json`, JSON.stringify({ at: new Date().toISOString(), ...override }, null, 2));
  return n;
}
export function versionOf(root, user, n) {
  const p = `${root}/.history/${user}/${String(n).padStart(4, "0")}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// --- resolve: YAML tree + override + data -> json-render flat spec
export async function resolve(root, page, user, role, fetchers) {
  const ctx = { ...loadProject(root), role };
  let tree = load(`${root}/pages/${page}.yaml`).layout;
  const ovPath = `${root}/overrides/user-${user}.yaml`;
  if (existsSync(ovPath)) tree = applyOverride(tree, load(ovPath));
  const errors = validateNode(tree, ctx, page, []);
  const elements = {}, state = { data: {} }; let n = 0;
  const walk = async (node, errPrefix) => {
    const id = `e${n++}`;
    const bad = errors.filter(e => e.startsWith(errPrefix + ":") );
    if (bad.length) { elements[id] = { type: "pt/fallback", props: { reason: bad.join("; ") } }; return id; }
    const props = { ...(node.props ?? {}) };
    if (node.data?.source) {
      const key = node.data.source.replace(/\./g, "_");
      state.data[key] = await fetchers[node.data.source](node.data.params ?? {});
      props.data = { $state: `/data/${key}` };
    }
    const el = { type: node.ref, props };
    if (node.children) {
      const named = !Array.isArray(node.children);
      const entries = named ? Object.entries(node.children) : node.children.map((c, i) => [i, c]);
      if (named) props.names = entries.map(([k]) => k);
      el.children = [];
      for (const [k, c] of entries) el.children.push(await walk(c, `${errPrefix}/${entries.findIndex(e => e[0] === k)}`));
    }
    elements[id] = el; return id;
  };
  const rootId = await walk(tree, page);
  return { spec: { root: rootId, elements, state }, errors };
}
