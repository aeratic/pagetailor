import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);
const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");

test("init then validate passes; broken page fails with exit 1 and a message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-cli-"));
  await writeFile(join(dir, "package.json"), '{"name":"x","dependencies":{"@aeratic/pagetailor":"*","react":"*","react-dom":"*"}}');
  const i = await run("node", [cli, "init"], { cwd: dir });
  assert.match(i.stdout, /created/);
  const v = await run("node", [cli, "validate"], { cwd: dir });
  assert.match(v.stdout, /all pages valid/);
  const page = join(dir, "pagetailor", "pages", "home.yaml");
  await writeFile(page, (await readFile(page, "utf8")).replace("sales.total", "sales.nope"));
  await assert.rejects(run("node", [cli, "validate"], { cwd: dir }), (e) => e.code === 1 && /unknown data source "sales.nope"/.test(e.stderr));
  await assert.rejects(run("node", [cli, "init"], { cwd: dir }), (e) => /already exists/.test(e.stderr));
  await rm(dir, { recursive: true, force: true });
});

test("dev server answers /api/page and /bundle.js", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-dev-"));
  await writeFile(join(dir, "package.json"), '{"name":"x"}');
  await run("node", [cli, "init"], { cwd: dir });
  const { spawn } = await import("node:child_process");
  const port = 4800 + Math.floor(Math.random() * 500);
  const child = spawn("node", [cli, "dev", "--port", String(port)], { cwd: dir, env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", DEEPSEEK_API_KEY: "", XAI_API_KEY: "", OPENROUTER_API_KEY: "", PAGETAILOR_PROVIDER: "" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { child.stdout.on("data", d => { if (String(d).includes("pagetailor dev")) res(); }); child.on("exit", rej); setTimeout(() => rej(new Error("dev did not start")), 15000); });
    const r = await (await fetch(`http://localhost:${port}/api/page/home?user=giulia&role=marketing`)).json();
    assert.deepEqual(r.errors, []); assert.equal(r.page, "home"); assert.ok(r.spec.root);
    const b = await (await fetch(`http://localhost:${port}/bundle.js`)).text();
    assert.ok(b.length > 10000); assert.match(b, /createRoot/); assert.doesNotMatch(b.slice(0, 2000), /Could not resolve|Build failed/); assert.match(b, /Studio/);
    const home = await fetch(`http://localhost:${port}/`); assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /--pt-color-primary/);
    const ov = await (await fetch(`http://localhost:${port}/api/override/user-giulia`)).json();
    assert.equal(ov.extends, "home"); assert.equal(ov.patches[0].op, "set-areas");
    assert.deepEqual(await (await fetch(`http://localhost:${port}/api/override/user-nobody`)).json(), {});
    const post = (path, b) => fetch(`http://localhost:${port}${path}`, { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
    const override = { extends: "home", patches: [{ op: "set-props", target: "kpi", props: { label: "Via proposta" } }] };
    const pr = await post("/api/propose", { name: "role-marketing", override, author: "ann" });
    assert.equal(pr.pending, true);
    const pending = await (await fetch(`http://localhost:${port}/api/pending`)).json();
    assert.equal(pending[0].name, "role-marketing");
    assert.equal((await post("/api/approve", { name: "role-marketing", version: pr.entry.version, approver: "boss", approverRole: "admin" })).ok, true);
    const after = await (await fetch(`http://localhost:${port}/api/page/home?role=marketing`)).json();
    assert.ok(Object.values(after.spec.elements).some(e => e.props?.label === "Via proposta"));
    const prompt = await (await fetch(`http://localhost:${port}/api/agent/prompt?page=home&user=giulia&role=marketing&request=ciao`)).json();
    assert.match(prompt.system, /charts\/line@1\.0\.0/); assert.equal(prompt.user, "ciao");
    const ag = await fetch(`http://localhost:${port}/api/agent`, { method: "POST", body: JSON.stringify({ page: "home", user: "giulia", request: "x" }) });
    assert.equal(ag.status, 503); assert.match((await ag.json()).error, /ANTHROPIC_API_KEY.*OPENAI_API_KEY/);
    const ask = await fetch(`http://localhost:${port}/api/ask`, { method: "POST", body: JSON.stringify({ user: "giulia", role: "marketing", request: "x" }) });
    assert.equal(ask.status, 503); assert.match((await ask.json()).error, /ANTHROPIC_API_KEY.*OPENAI_API_KEY/);
    const base = `http://localhost:${port}`;
    const proj = await (await fetch(`${base}/api/project`)).json();
    assert.equal(proj.manifest.home, "home"); assert.deepEqual(proj.pages, ["home"]); assert.ok(proj.catalog["sales.total"]); assert.ok(proj.registry["layout/grid"]); assert.ok(proj.tokens); assert.ok(proj.overrides.includes("user-giulia"));
    const put = (name, b) => fetch(`${base}/api/files/${name}`, { method: "PUT", body: JSON.stringify(b) });
    const m = (await (await fetch(`${base}/api/files/manifest`)).json()).value;
    const w = await put("manifest", { value: { ...m, roles: [...m.roles, "sales"] }, why: "test" });
    assert.equal(w.status, 200);
    assert.ok((await (await fetch(`${base}/api/files/manifest`)).json()).value.roles.includes("sales"));
    const hist = await (await fetch(`${base}/api/files/manifest/history`)).json();
    assert.equal(hist[0].why, "test");
    assert.equal((await (await fetch(`${base}/api/files/manifest/undo`, { method: "POST" })).json()).ok, true);
    assert.deepEqual((await (await fetch(`${base}/api/files/manifest`)).json()).value.roles, m.roles);
    const bad = await put("manifest", { value: { ...m, owners: { home: ["ghost"] } } });
    assert.equal(bad.status, 400); const be = await bad.json(); assert.equal(be.ok, false); assert.match(be.errors.join(), /ghost/);
    assert.equal((await fetch(`${base}/api/files/..%2Fsecret`)).status, 400);
    assert.equal((await fetch(`${base}/api/files/pages/home`, { method: "DELETE" })).status, 400);
    // bound to localhost only: the same port on a non-loopback interface is not reachable
    const { networkInterfaces } = await import("node:os");
    const ext = Object.values(networkInterfaces()).flat().find(i => i.family === "IPv4" && !i.internal)?.address;
    if (ext) await assert.rejects(fetch(`http://${ext}:${port}/api/project`, { signal: AbortSignal.timeout(3000) }));
  } finally { child.kill("SIGKILL"); await rm(dir, { recursive: true, force: true }); }
});

test("help and --version", async () => {
  const pkg = JSON.parse(await readFile(join(dirname(cli), "..", "package.json"), "utf8"));
  assert.equal((await run("node", [cli, "--version"])).stdout.trim(), pkg.version);
  assert.equal((await run("node", [cli, "-v"])).stdout.trim(), pkg.version);
  for (const a of [[], ["help"], ["--help"]]) assert.match((await run("node", [cli, ...a])).stdout, /pagetailor <command>/);
  await assert.rejects(run("node", [cli, "nope"]), e => e.code === 1 && /unknown command "nope"/.test(e.stderr));
});

test("init writes components/index.js; registry is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-reg-"));
  await writeFile(join(dir, "package.json"), '{"name":"x"}');
  await run("node", [cli, "init"], { cwd: dir });
  const file = join(dir, "pagetailor", "components", "index.js");
  const first = await readFile(file, "utf8");
  assert.match(first, /generated by `pagetailor registry`, do not edit/);
  assert.equal((first.match(/^import /gm) ?? []).length, 9);
  for (const k of ["layout/stack@1.0.0", "layout/row@1.0.0", "layout/card@1.0.0", "layout/grid@1.0.0", "text/block@1.0.0", "kpi/number@1.0.0", "charts/line@1.0.0", "tables/simple@1.0.0", "todo/list@1.0.0"])
    assert.ok(first.includes(JSON.stringify(k)), k);
  assert.match(first, /from "\.\/Card\.jsx"/);
  const r = await run("node", [cli, "registry"], { cwd: dir });
  assert.match(r.stdout, /9 components/);
  assert.equal(await readFile(file, "utf8"), first);
  await rm(dir, { recursive: true, force: true });
});

test("dev on a busy port exits 1 with a clear message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-port-"));
  await writeFile(join(dir, "package.json"), '{"name":"x"}');
  await run("node", [cli, "init"], { cwd: dir });
  const { spawn } = await import("node:child_process");
  const port = 5300 + Math.floor(Math.random() * 500);
  const first = spawn("node", [cli, "dev", "--port", String(port)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { first.stdout.on("data", d => { if (String(d).includes("pagetailor dev")) res(); }); first.on("exit", rej); setTimeout(() => rej(new Error("dev did not start")), 15000); });
    await assert.rejects(run("node", [cli, "dev", "--port", String(port)], { cwd: dir, timeout: 15000 }),
      (e) => e.code === 1 && e.stderr.includes(`pagetailor: port ${port} is already in use (try --port ${port + 1})`) && !/at /.test(e.stderr));
  } finally { first.kill("SIGKILL"); await rm(dir, { recursive: true, force: true }); }
});
