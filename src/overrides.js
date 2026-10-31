import { splitRef } from "./validator.js";

// Ops work on the YAML tree, by component name or by child name, never by element id.
//   { op: set-areas, target: layout/grid, areas: "..." }
//   { op: replace,   target: chart, with: { ref, props, data } }
//   { op: remove,    target: kpi }
//   { op: set-props, target: charts/line, props: { title: "..." } }
//   { op: set-data,  target: chart, data: { source, params } }
//   { op: insert,    target: <container>, name?: todo2, node: {...}, before?: <child name>, area?: "..." }
//   { op: move,      target: <child name>, to: 0 }   (array children only)

export function applyOverride(tree, override) {
  const t = structuredClone(tree);
  const errors = [];
  for (const [i, p] of (override.patches ?? []).entries()) {
    const found = find(t, p.target);
    if (!found) { errors.push({ path: `${override.name ?? "override"}/${i}`, message: `patch target "${p.target}" not found` }); continue; }
    const { parent, key, node } = found;
    switch (p.op) {
      case "set-areas": (node.props ??= {}).areas = p.areas; break;
      case "set-props": Object.assign(node.props ??= {}, p.props); break;
      case "set-data":  node.data = p.data; break;
      case "replace":   if (parent) parent[key] = p.with; else Object.assign(t, p.with); break;
      case "remove":    if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; break;
      case "insert": {
        if (Array.isArray(node.children)) { const at = p.before != null ? node.children.findIndex(c => splitRef(c.ref)[0] === p.before) : node.children.length; node.children.splice(at < 0 ? node.children.length : at, 0, p.node); }
        else { (node.children ??= {})[p.name] = p.node; if (p.area) (node.props ??= {}).areas = p.area; }
        break;
      }
      case "move": { if (!Array.isArray(parent)) { errors.push({ path: `${i}`, message: "move works on array children" }); break; } const [n] = parent.splice(key, 1); parent.splice(p.to, 0, n); break; }
      default: errors.push({ path: `${i}`, message: `unknown op "${p.op}"` });
    }
  }
  return { tree: t, errors };
}

export function find(node, target, parent = null, key = null) {
  if (!node || typeof node !== "object") return null;
  if (key === target || (node.ref && splitRef(node.ref)[0] === target) || node.ref === target) return { parent, key, node };
  const kids = node.children; if (!kids) return null;
  for (const [k, v] of Object.entries(kids)) { const r = find(v, target, kids, Array.isArray(kids) ? Number(k) : k); if (r) return r; }
  return null;
}

// A set-areas patch replaces an earlier set-areas on the same target; anything else is appended.
export function mergePatch(patches = [], patch) {
  const i = patch.op === "set-areas" ? patches.findIndex(p => p.op === "set-areas" && p.target === patch.target) : -1;
  if (i < 0) return [...patches, patch];
  const out = [...patches]; out[i] = patch; return out;
}
