import { readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

const cache = new Map(); // path -> { mtime, value }

export async function loadYaml(path) {
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path);
  if (hit && hit.mtime === mtimeMs) return hit.value;
  const value = parse(await readFile(path, "utf8"));
  cache.set(path, { mtime: mtimeMs, value });
  return value;
}

export async function exists(path) { try { await stat(path); return true; } catch { return false; } }

export async function loadProject(root) {
  const [manifest, tokens, catalog, registry] = await Promise.all([
    loadYaml(join(root, "manifest.yaml")),
    loadYaml(join(root, "tokens.yaml")),
    loadYaml(join(root, "data-catalog.yaml")),
    loadYaml(join(root, "components", "registry.yaml")),
  ]);
  return { root, manifest, tokens, catalog, registry };
}

export async function loadPage(root, page) { return loadYaml(join(root, "pages", `${page}.yaml`)); }

export async function loadOverrides(root, page, user, role) {
  // role first, then user: each one a small patch file, missing file = no patch
  const out = [];
  for (const name of [role && `role-${role}`, user && `user-${user}`].filter(Boolean)) {
    const p = join(root, "overrides", `${name}.yaml`);
    if (await exists(p)) { const ov = await loadYaml(p); if (!ov.extends || ov.extends === page) out.push({ name, ...ov }); }
  }
  return out;
}

export async function listPages(root) {
  return (await readdir(join(root, "pages"))).filter(f => f.endsWith(".yaml")).map(f => f.slice(0, -5));
}
export async function listOverrides(root) {
  const dir = join(root, "overrides");
  if (!(await exists(dir))) return [];
  return (await readdir(dir)).filter(f => f.endsWith(".yaml")).map(f => f.slice(0, -5));
}

export async function loadSources(root) {
  const p = join(root, "data", "sources.mjs");
  if (!(await exists(p))) return {};
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `file://${p}?t=${Date.now()}`);
  return mod.default ?? mod.sources ?? mod;
}
