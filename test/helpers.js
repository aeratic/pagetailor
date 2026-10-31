import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const templates = join(here, "..", "templates");

// A throwaway copy of the templates as a pagetailor/ project root.
export async function tempProject() {
  const dir = await mkdtemp(join(tmpdir(), "pagetailor-"));
  const root = join(dir, "pagetailor");
  await cp(templates, root, { recursive: true });
  return { dir, root, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const node = (ref, extra = {}) => ({ ref, ...extra });
