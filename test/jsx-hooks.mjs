import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
export async function load(url, context, next) {
  if (!url.endsWith(".jsx")) return next(url, context);
  const src = await readFile(new URL(url), "utf8");
  const { code } = await transform(src, { loader: "jsx", jsx: "automatic", format: "esm", sourcefile: url });
  return { format: "module", source: code, shortCircuit: true };
}
