import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { loadYaml } from "../src/loader.js";
import { tokensToCss } from "../src/tokens.js";
import { tempProject } from "./helpers.js";

test("loader caches by mtime and reloads on change", async () => {
  const p = await tempProject();
  const f = join(p.root, "manifest.yaml");
  const a = await loadYaml(f); assert.equal(await loadYaml(f), a);
  await writeFile(f, "app: changed\npages: []\n"); await utimes(f, new Date(), new Date(Date.now() + 5000));
  assert.equal((await loadYaml(f)).app, "changed");
  await p.cleanup();
});
test("tokens become CSS variables, numbers get px", () => {
  const css = tokensToCss({ color: { primary: "#000" }, spacing: { md: 16 }, radius: 8, font: { base: "Inter" } });
  assert.match(css, /--pt-color-primary: #000;/); assert.match(css, /--pt-spacing-md: 16px;/); assert.match(css, /--pt-radius: 8px;/); assert.match(css, /--pt-font-base: Inter;/);
});
