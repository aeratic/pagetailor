#!/usr/bin/env node
import { init } from "../src/init.js";
import { validate } from "../src/validate.js";
import { dev } from "../src/dev.js";
import { writeRegistryFile } from "../src/registry-file.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const help = `pagetailor <command>

  init [--force]     create pagetailor/ with manifest, tokens, data catalog, a sample page, overrides and base components
  validate           check manifest, pages and overrides against the component registry and the data catalog
  registry          write pagetailor/components/index.js exporting every component in registry.yaml
  dev [--port 4747]  preview server with live reload; ?page=home&user=giulia&role=marketing
`;

try {
  if (cmd === "init") await init(process.cwd(), args);
  else if (cmd === "validate") process.exitCode = (await validate(process.cwd())) ? 0 : 1;
  else if (cmd === "registry") { const r = await writeRegistryFile(process.cwd()); console.log(`wrote ${r.path} (${r.count} components)`); }
  else if (cmd === "dev") await dev(process.cwd(), { port: Number(flag("--port", 4747)) });
  else { console.log(help); if (cmd && cmd !== "help") process.exitCode = 1; }
} catch (e) { console.error("pagetailor:", e.message); process.exitCode = 1; }
