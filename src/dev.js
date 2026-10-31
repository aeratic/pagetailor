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
import { anthropicComplete } from "./llm.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function dev(cwd, { port = 4747 } = {}) {
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

  // one generated entry: imports every component from registry.yaml, mounts <Page>
  const entry = async () => {
    const reg = await loadYaml(join(root, "components", "registry.yaml"));
    const imports = [], map = [];
    let i = 0;
    for (const [name, def] of Object.entries(reg)) for (const [ver, v] of Object.entries(def.versions ?? {})) {
      if (!v.impl) continue; const id = `C${i++}`;
      imports.push(`import ${id} from ${JSON.stringify(v.impl)};`);
      map.push(`${JSON.stringify(`${name}@${ver}`)}: ${id}`);
    }
    return `${imports.join("\n")}
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { Page, EditorContext, useEditor } from ${JSON.stringify(join(here, "client.jsx"))};
const registry = { ${map.join(", ")} };
function App() {
  const q = new URLSearchParams(location.search);
  const [page, setPage] = useState(q.get("page") || "__home__");
  const [user, setUser] = useState(q.get("user") || "");
  const [role, setRole] = useState(q.get("role") || "");
  const [state, setState] = useState(null);
  const load = useCallback(() => fetch(\`/api/page/\${page}?user=\${user}&role=\${role}\`).then(r => r.json()).then(setState), [page, user, role]);
  useEffect(() => { load(); }, [load]);
  // keep page/user/role in the URL: the file watcher reloads the tab after an override is written
  useEffect(() => { const u = new URLSearchParams({ page, user, role }); history.replaceState(null, "", "?" + u); }, [page, user, role]);
  const editor = useEditor({ page: state?.page, user, role, why: "reordered in the editor", onApplied: r => { if (!r.pending) load(); } });
  const [ask, setAsk] = useState(""), [agent, setAgent] = useState(null);
  const sendAsk = async e => {
    e.preventDefault(); if (!ask.trim()) return;
    setAgent({ text: "thinking…" });
    try {
      const r = await (await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: state.page, user, role: role || undefined, request: ask }) })).json();
      if (r.ok) setAgent({ text: (r.proposal.pending ? "sent for approval: " : "applied: ") + (r.reply.why ?? "") });
      else setAgent({ error: true, text: r.refuse ?? (r.errors ?? [r.error ?? "agent failed"]).join("; ") });
    } catch (err) { setAgent({ error: true, text: err.message }); }
  };
  const [question, setQuestion] = useState(""), [answer, setAnswer] = useState(null), [answerStatus, setAnswerStatus] = useState(null);
  const post = (path, b) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  const sendQuestion = async e => {
    e.preventDefault(); if (!question.trim()) return;
    setAnswer(null); setAnswerStatus({ text: "composing…" });
    try {
      const r = await post("/api/ask", { user, role: role || undefined, request: question });
      if (r.ok) { setAnswer(r); setAnswerStatus(null); }
      else setAnswerStatus({ error: true, text: r.refuse ?? (r.errors ?? [r.error ?? "ask failed"]).join("; ") });
    } catch (err) { setAnswerStatus({ error: true, text: err.message }); }
  };
  const answerBody = () => ({ user, role: role || undefined, title: answer.title, tree: answer.tree, why: answer.why });
  const keep = async () => {
    const r = await post("/api/ask/keep", answerBody());
    if (r.ok) { setAnswer(null); setAnswerStatus(null); setPage(r.page); } else setAnswerStatus({ error: true, text: (r.errors ?? [r.error]).join("; ") });
  };
  const pin = async () => {
    const r = await post("/api/ask/pin", answerBody());
    setAnswerStatus(r.ok ? { text: r.pending ? "sent for approval" : "applied to home" } : { error: true, text: (r.errors ?? [r.error]).join("; ") });
  };
  useEffect(() => { const es = new EventSource("/events"); es.onmessage = () => location.reload(); return () => es.close(); }, []);
  if (!state) return null;
  const pages = state.manifest.pages, roles = state.manifest.roles ?? [];
  return <>
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--pt-color-border)", background: "var(--pt-color-surface)", fontSize: 13 }}>
      <strong>{state.manifest.app}</strong>
      <label>page <select value={state.page} onChange={e => setPage(e.target.value)}>{pages.map(p => <option key={p}>{p}</option>)}</select></label>
      <label>user <input value={user} placeholder="giulia" onChange={e => setUser(e.target.value)} style={{ width: 90 }} /></label>
      <label>role <select value={role} onChange={e => setRole(e.target.value)}><option value="">(none)</option>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
      <button onClick={() => editor.setEditing(!editor.editing)} style={{ fontWeight: editor.editing ? 700 : 400 }}>{editor.editing ? "Done editing" : "Edit layout"}</button>
      {editor.status === "saving" && <span>saving…</span>}
      {editor.status === "pending" && <span>sent for approval</span>}
      {editor.status === "error" && <span style={{ color: "var(--pt-color-danger)" }}>{editor.errors.join("; ")}</span>}
      <form onSubmit={sendAsk} style={{ display: "flex", gap: 6 }}><input value={ask} placeholder="Change this page…" onChange={e => setAsk(e.target.value)} style={{ width: 220 }} /><button type="submit">Ask</button></form>
      <form onSubmit={sendQuestion} style={{ display: "flex", gap: 6 }}><input value={question} placeholder="Ask…" onChange={e => setQuestion(e.target.value)} style={{ width: 220 }} /><button type="submit">Ask</button></form>
      {agent && <span style={{ color: agent.error ? "var(--pt-color-danger)" : undefined }}>{agent.text}</span>}
      {state.errors.length > 0 && <span style={{ color: "var(--pt-color-danger)" }}>{state.errors.length} problem(s), see console</span>}
    </header>
    {(answer || answerStatus) && <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--pt-color-border)", fontSize: 13 }}>
      {answer && <><strong>{answer.title}</strong><span>{answer.why}</span><button onClick={keep}>Keep as page</button><button onClick={pin}>Pin to home</button><button onClick={() => { setAnswer(null); setAnswerStatus(null); }}>Back</button></>}
      {answerStatus && <span style={{ color: answerStatus.error ? "var(--pt-color-danger)" : undefined }}>{answerStatus.text}</span>}
    </div>}
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>{answer
      ? <Page resolved={{ ...state, spec: answer.resolved.spec, errors: answer.resolved.errors }} registry={registry} />
      : <EditorContext.Provider value={{ editing: editor.editing, propose: editor.propose }}><Page resolved={state} registry={registry} /></EditorContext.Provider>}</main>
  </>;
}
createRoot(document.getElementById("root")).render(<App />);`;
  };

  const ctx = await esbuild.context({
    stdin: { contents: await entry(), resolveDir: join(root, "components"), loader: "jsx", sourcefile: "pagetailor-entry.jsx" },
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
        if (!process.env.ANTHROPIC_API_KEY) return json(res, 503, { error: "set ANTHROPIC_API_KEY to use the agent" });
        const b = await body(req);
        const complete = anthropicComplete({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.PAGETAILOR_MODEL ? { model: process.env.PAGETAILOR_MODEL } : {}) });
        const r = await runAgent(root, { page: b.page, user: b.user, role: b.role || undefined, request: b.request, complete });
        return json(res, r.ok ? 200 : 400, r);
      }
      if (url.pathname === "/api/ask" && req.method === "POST") {
        if (!process.env.ANTHROPIC_API_KEY) return json(res, 503, { error: "set ANTHROPIC_API_KEY to use the agent" });
        const b = await body(req);
        const complete = anthropicComplete({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.PAGETAILOR_MODEL ? { model: process.env.PAGETAILOR_MODEL } : {}) });
        const r = await runAsk(root, { user: b.user || undefined, role: b.role || undefined, request: b.request, complete });
        return json(res, r.ok ? 200 : 400, r);
      }
      const answer = { "/api/ask/keep": keepAnswer, "/api/ask/pin": pinAnswer }[url.pathname];
      if (answer && req.method === "POST") { const b = await body(req); const r = await answer(root, { ...b, user: b.user || undefined, role: b.role || undefined }); return json(res, r.ok ? 200 : 400, r); }
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
  await new Promise(r => server.listen(port, r));
  console.log(`pagetailor dev  http://localhost:${port}\n  pages from ${root}\n  ?page=home&user=giulia&role=marketing`);
  return server;
}
