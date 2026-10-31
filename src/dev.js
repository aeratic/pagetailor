import http from "node:http";
import { watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { resolve } from "./resolver.js";
import { loadProject, loadYaml, listPages } from "./loader.js";
import { commitOverride, listHistory, rollback } from "./history.js";
import { propose, listPending, approve, reject } from "./proposals.js";
import { tokensToCss } from "./tokens.js";
import { buildAgentPrompt, runAgent, runAsk, keepAnswer, pinAnswer } from "./agent.js";
import { completeFromEnv, LLM_HELP } from "./llm.js";
import { isProjectFile, readProjectFile, writeProjectFile, deleteProjectFile, listFileHistory, undoFile, readProject, scaffoldSource, scaffoldComponent } from "./files.js";

const here = dirname(fileURLToPath(import.meta.url));

// Binds to localhost only: the API writes project files and has no authentication. Pass host to expose it.
export async function dev(cwd, { port = 4747, host = "127.0.0.1" } = {}) {
  const root = join(cwd, "pagetailor");
  // Bundle one React only: the project's if installed, otherwise the one shipped with this package.
  const reqProject = createRequire(join(cwd, "package.json")), reqSelf = createRequire(import.meta.url);
  const alias = {};
  for (const m of ["react", "react-dom", "react/jsx-runtime", "react-dom/client"]) {
    try { alias[m] = reqProject.resolve(m); } catch { try { alias[m] = reqSelf.resolve(m); } catch {} }
  }
  // components import "@aeratic/pagetailor/client": always the same file as the entry, so EditorContext is shared
  alias["@aeratic/pagetailor/client"] = join(here, "client.jsx");
  const nodePaths = [join(cwd, "node_modules"), join(here, "..", "node_modules")];

  // the Studio entry imports the project's components through a virtual module built from registry.yaml,
  // regenerated on every rebuild
  const registryPlugin = {
    name: "pagetailor-registry",
    setup(build) {
      build.onResolve({ filter: /^pagetailor:registry$/ }, () => ({ path: "registry", namespace: "pagetailor" }));
      build.onLoad({ filter: /.*/, namespace: "pagetailor" }, async () => {
        const reg = await loadYaml(join(root, "components", "registry.yaml"));
        const imports = [], map = [];
        let i = 0;
        for (const [name, def] of Object.entries(reg ?? {})) for (const [ver, v] of Object.entries(def.versions ?? {})) {
          if (!v.impl) continue; const id = `C${i++}`;
          imports.push(`import ${id} from ${JSON.stringify(v.impl)};`);
          map.push(`${JSON.stringify(`${name}@${ver}`)}: ${id}`);
        }
        return { contents: `${imports.join("\n")}\nexport const registry = { ${map.join(", ")} };\n`, resolveDir: join(root, "components"), loader: "jsx" };
      });
    },
  };

  const ctx = await esbuild.context({
    entryPoints: [join(here, "studio", "entry.jsx")], plugins: [registryPlugin],
    bundle: true, write: false, format: "esm", jsx: "automatic", alias, nodePaths, outfile: "bundle.js", sourcemap: "inline", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  let bundle = "", buildErrors = [];
  const rebuild = async () => {
    try { const r = await ctx.rebuild(); bundle = r.outputFiles[0].text; buildErrors = []; }
    catch (e) { buildErrors = e.errors ?? [{ text: e.message }]; console.error("build:", buildErrors.map(x => x.text).join("\n")); }
  };
  await rebuild();

  const clients = new Set();
  let timer;
  watch(root, { recursive: true }, (_, file) => {
    if (file?.includes(".history")) return;
    clearTimeout(timer);
    timer = setTimeout(async () => { await rebuild(); for (const c of clients) c.write("data: reload\n\n"); console.log("reloaded:", file); }, 80);
  });

  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const body = req => new Promise(r => { let s = ""; req.on("data", c => s += c); req.on("end", () => r(s ? JSON.parse(s) : {})); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname === "/") {
        const { tokens, manifest } = await loadProject(root);
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${manifest.app}</title><style>${tokensToCss(tokens)} body{margin:0;background:var(--pt-color-background);color:var(--pt-color-text);font-family:var(--pt-font-base);font-size:var(--pt-font-size)}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`);
      }
      if (url.pathname === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(buildErrors.length ? `document.body.innerHTML='<pre style="color:#C0392B;padding:16px">'+${JSON.stringify(buildErrors.map(e => e.text).join("\n"))}+'</pre>'` : bundle); }
      if (url.pathname === "/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); res.write("\n"); clients.add(res); req.on("close", () => clients.delete(res)); return; }
      if (url.pathname.startsWith("/api/page/")) {
        let page = decodeURIComponent(url.pathname.slice(10));
        if (page === "__home__") page = (await loadProject(root)).manifest.home ?? (await listPages(root))[0];
        const r = await resolve(root, page, { user: url.searchParams.get("user") || undefined, role: url.searchParams.get("role") || undefined, maxAge: 2000 });
        if (r.errors.length) console.warn(`[${page}]`, r.errors.map(e => `${e.path}: ${e.message}`).join("\n  "));
        return json(res, 200, { page, ...r });
      }
      if (url.pathname.startsWith("/api/override/") && req.method === "GET") {
        const name = decodeURIComponent(url.pathname.slice(14));
        if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: "bad override name" });
        let ov = {}; try { ov = (await loadYaml(join(root, "overrides", `${name}.yaml`))) ?? {}; } catch {}
        return json(res, 200, ov);
      }
      if (url.pathname.startsWith("/api/history/")) return json(res, 200, await listHistory(root, url.pathname.slice(13)));
      if (url.pathname === "/api/override" && req.method === "POST") { const b = await body(req); return json(res, 200, await commitOverride(root, b.name, b.override, { author: b.author })); }
      if (url.pathname === "/api/agent/prompt" && req.method === "GET") {
        const q = Object.fromEntries(url.searchParams);
        return json(res, 200, await buildAgentPrompt(root, { page: q.page || "home", user: q.user || undefined, role: q.role || undefined, request: q.request ?? "" }));
      }
      if (url.pathname === "/api/agent" && req.method === "POST") {
        const complete = completeFromEnv();
        if (!complete) return json(res, 503, { error: LLM_HELP });
        const b = await body(req);
        const r = await runAgent(root, { page: b.page, user: b.user, role: b.role || undefined, request: b.request, complete });
        return json(res, r.ok ? 200 : 400, r);
      }
      if (url.pathname === "/api/ask" && req.method === "POST") {
        const complete = completeFromEnv();
        if (!complete) return json(res, 503, { error: LLM_HELP });
        const b = await body(req);
        const r = await runAsk(root, { user: b.user || undefined, role: b.role || undefined, request: b.request, complete });
        return json(res, r.ok ? 200 : 400, r);
      }
      const answer = { "/api/ask/keep": keepAnswer, "/api/ask/pin": pinAnswer }[url.pathname];
      if (answer && req.method === "POST") { const b = await body(req); const r = await answer(root, { ...b, user: b.user || undefined, role: b.role || undefined }); return json(res, r.ok ? 200 : 400, r); }
      if (url.pathname === "/api/project" && req.method === "GET") return json(res, 200, await readProject(root));
      if (url.pathname.startsWith("/api/files/")) {
        let name = decodeURIComponent(url.pathname.slice(11)), action = null;
        const m = /^(.+)\/(history|undo)$/.exec(name);
        if (m && isProjectFile(m[1])) { name = m[1]; action = m[2]; }
        if (!isProjectFile(name)) return json(res, 400, { ok: false, errors: [`not a project file: ${name}`] });
        if (action === "history" && req.method === "GET") return json(res, 200, await listFileHistory(root, name));
        if (action === "undo" && req.method === "POST") { const r = await undoFile(root, name, { author: "studio" }); return json(res, r.ok ? 200 : 400, r); }
        if (!action && req.method === "GET") return json(res, 200, { name, value: await readProjectFile(root, name) });
        if (!action && req.method === "PUT") { const b = await body(req); const r = await writeProjectFile(root, name, b.value, { author: b.author ?? "studio", why: b.why ?? "edited in studio" }); return json(res, r.ok ? 200 : 400, r); }
        if (!action && req.method === "DELETE") { const r = await deleteProjectFile(root, name, { author: "studio" }); return json(res, r.ok ? 200 : 400, r); }
        return json(res, 405, { ok: false, errors: ["method not allowed"] });
      }
      if (url.pathname === "/api/scaffold/source" && req.method === "POST") { const b = await body(req); return json(res, 200, await scaffoldSource(root, b.name)); }
      if (url.pathname === "/api/scaffold/component" && req.method === "POST") { const b = await body(req); return json(res, 200, await scaffoldComponent(root, b.name, { props: b.props, container: b.container })); }
      if (url.pathname === "/api/pending") return json(res, 200, await listPending(root));
      const flow = { "/api/propose": propose, "/api/approve": approve, "/api/reject": reject }[url.pathname];
      if (flow && req.method === "POST") { const r = await flow(root, await body(req)); return json(res, r.ok ? 200 : 400, r); }
      if (url.pathname === "/api/rollback" && req.method === "POST") { const b = await body(req); return json(res, 200, await rollback(root, b.name, b.version, { author: b.author })); }
      json(res, 404, { error: "not found" });
    } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
  });
  server.on("error", e => {
    if (e.code !== "EADDRINUSE") throw e;
    console.error(`pagetailor: port ${port} is already in use (try --port ${port + 1})`);
    process.exit(1);
  });
  await new Promise(r => server.listen(port, host, r));
  console.log(`pagetailor dev  http://${host === "0.0.0.0" || host === "::" ? "localhost" : host}:${port}\n  pages from ${root}\n  ?page=home&user=giulia&role=marketing`);
  return server;
}
