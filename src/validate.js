import { join } from "node:path";
import { loadProject, loadPage, listPages, listOverrides, loadYaml } from "./loader.js";
import { validateTree, validateManifest } from "./validator.js";
import { applyOverride } from "./overrides.js";

export async function validate(cwd) {
  const root = join(cwd, "pagetailor");
  const project = await loadProject(root);
  const pages = await listPages(root);
  const problems = validateManifest(project.manifest, pages).map(e => `manifest.yaml: ${e.message}`);
  const trees = {};
  for (const p of pages) {
    trees[p] = (await loadPage(root, p)).layout;
    for (const e of validateTree(trees[p], project)) problems.push(`pages/${p}.yaml ${e.path}: ${e.message}`);
  }
  for (const name of await listOverrides(root)) {
    const ov = await loadYaml(join(root, "overrides", `${name}.yaml`));
    const targets = ov.extends ? [ov.extends] : pages;
    const role = name.startsWith("role-") ? name.slice(5) : undefined;
    for (const p of targets) {
      if (!trees[p]) { problems.push(`overrides/${name}.yaml: extends unknown page "${p}"`); continue; }
      const r = applyOverride(trees[p], { name, ...ov });
      for (const e of r.errors) problems.push(`overrides/${name}.yaml ${e.path}: ${e.message}`);
      for (const e of validateTree(r.tree, project, { role })) problems.push(`overrides/${name}.yaml on ${p} ${e.path}: ${e.message}`);
    }
  }
  if (problems.length) { console.error(problems.join("\n")); console.error(`\n${problems.length} problem(s)`); return false; }
  console.log(`all pages valid (${pages.length} page(s))`); return true;
}
