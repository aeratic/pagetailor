import { validateProps } from "./props.js";

// One validator used everywhere: CLI, resolver at runtime, agent gate.
// A node is { ref: "name@version", props?, data?: { source, params? }, children?: [] | {name: node} }

export const childrenOf = (node) => !node?.children ? [] : Array.isArray(node.children) ? node.children : Object.values(node.children);
export const splitRef = (ref) => { const i = String(ref).lastIndexOf("@"); return i < 0 ? [ref, null] : [ref.slice(0, i), ref.slice(i + 1)]; };

// v0 type lattice: exact match, "any" accepts everything, "list<any>" / "table<any>" accept any list / table
export function typeAccepts(accepts, returns) {
  if (!accepts || accepts === "any") return true;
  if (accepts === returns) return true;
  const m = /^(\w+)<any>$/.exec(accepts);
  return !!m && returns.startsWith(m[1] + "<");
}

export function validateTree(tree, project, { role } = {}) {
  const errors = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object" || !node.ref) { errors.push({ path, message: "node has no ref" }); return; }
    const [name, version] = splitRef(node.ref);
    const comp = project.registry[name];
    if (!comp) errors.push({ path, message: `unknown component "${name}"` });
    else if (version && !comp.versions?.[version]) errors.push({ path, message: `"${name}" has no version ${version}` });
    if (comp) for (const message of validateProps(node.props, comp.props)) errors.push({ path, message });
    if (node.data?.source) {
      const src = project.catalog[node.data.source];
      if (!src) errors.push({ path, message: `unknown data source "${node.data.source}"` });
      else {
        if (role !== undefined && src.roles && !src.roles.includes("*") && !src.roles.includes(role))
          errors.push({ path, message: `role "${role ?? "none"}" cannot read "${node.data.source}"` });
        if (comp?.accepts && src.returns && !typeAccepts(comp.accepts, src.returns))
          errors.push({ path, message: `"${name}" accepts ${comp.accepts} but "${node.data.source}" returns ${src.returns}` });
        for (const [k, v] of Object.entries(node.data.params ?? {})) {
          const allowed = src.params?.[k];
          if (allowed === undefined) errors.push({ path, message: `"${node.data.source}" has no param "${k}"` });
          else if (Array.isArray(allowed) && !allowed.includes(v)) errors.push({ path, message: `param ${k}=${v} not in [${allowed.join(", ")}]` });
        }
      }
    }
    if (node.children && !Array.isArray(node.children) && node.props?.areas) {
      const names = Object.keys(node.children);
      const inAreas = new Set(String(node.props.areas).split(/\s+/).filter(Boolean).filter(a => a !== "."));
      for (const a of inAreas) if (!names.includes(a)) errors.push({ path, message: `area "${a}" has no child` });
      for (const n of names) if (!inAreas.has(n)) errors.push({ path, message: `child "${n}" is not placed in areas` });
    }
    childrenOf(node).forEach((c, i) => walk(c, `${path}/${i}`));
  };
  walk(tree, "root");
  return errors;
}

export function validateManifest(manifest, pages) {
  const errors = [];
  for (const p of manifest.pages ?? []) if (!pages.includes(p)) errors.push({ path: "manifest", message: `page "${p}" listed but pages/${p}.yaml is missing` });
  for (const p of pages) if (!(manifest.pages ?? []).includes(p)) errors.push({ path: "manifest", message: `pages/${p}.yaml exists but is not listed in manifest.pages` });
  for (const [page, roles] of Object.entries(manifest.owners ?? {})) {
    if (!(manifest.pages ?? []).includes(page)) errors.push({ path: "manifest", message: `owners: page "${page}" is not in pages` });
    for (const r of [].concat(roles ?? [])) if (!(manifest.roles ?? []).includes(r)) errors.push({ path: "manifest", message: `owners: role "${r}" of page "${page}" is not in roles` });
  }
  if (manifest.home && !pages.includes(manifest.home)) errors.push({ path: "manifest", message: `home "${manifest.home}" is not a page` });
  return errors;
}
