import { join } from "node:path";
import { writeYaml } from "./yaml-write.js";
import { loadProject, loadPage, loadOverrides, loadYaml, exists, listPages } from "./loader.js";
import { applyOverride, mergePatch } from "./overrides.js";
import { splitRef, validateTree } from "./validator.js";
import { propose } from "./proposals.js";
import { resolve } from "./resolver.js";

// The agent never writes files: it turns a request into override patches and hands them to propose().
const OPS = [
  ["set-areas", { op: "set-areas", target: "layout/grid", areas: "kpi kpi\nchart chart\n" }],
  ["set-props", { op: "set-props", target: "kpi", props: { label: "Sales" } }],
  ["set-data", { op: "set-data", target: "chart", data: { source: "<source>", params: { "<param>": "<value>" } } }],
  ["replace", { op: "replace", target: "chart", with: { ref: "<component@version>", props: { title: "..." }, data: { source: "<source>" } } }],
  ["remove", { op: "remove", target: "kpi" }],
  ["insert", { op: "insert", target: "layout/grid", name: "notes", node: { ref: "text/block@1.0.0", props: { content: "Hi" } }, area: "notes notes\nchart chart\n" }],
  ["move", { op: "move", target: "todo/list", to: 0 }],
];
const readable = (src, role) => !src.roles || src.roles.includes("*") || (role != null && src.roles.includes(role));

export function describeCatalog(project, { role } = {}) {
  const out = ["COMPONENTS"];
  for (const [name, c] of Object.entries(project.registry ?? {})) for (const v of Object.keys(c.versions ?? {})) {
    const props = Object.entries(c.props ?? {}).map(([k, t]) => `${k}: ${t}`).join(", ");
    out.push(`- ${name}@${v}: ${c.description ?? name}${c.container ? " [container]" : ""}${c.accepts ? `; accepts ${c.accepts}` : ""}; props { ${props} }`);
  }
  out.push("", `DATA SOURCES (readable by role ${role ?? "none"})`);
  for (const [name, s] of Object.entries(project.catalog ?? {})) {
    if (!readable(s, role)) continue;
    const params = Object.entries(s.params ?? {}).map(([k, v]) => `${k}: ${[].concat(v).join("|")}`).join(", ");
    out.push(`- ${name}: ${s.description ?? name}; returns ${s.returns ?? "any"}${params ? `; params { ${params} }` : ""}`);
  }
  out.push("", "OVERRIDE OPS (target = a child name or a component name)");
  for (const [op, ex] of OPS) out.push(`- ${op}: ${JSON.stringify(ex)}${op === "move" ? " (array children only)" : ""}`);
  return out.join("\n");
}

async function currentTree(root, page, { user, role } = {}) {
  let tree = (await loadPage(root, page)).layout;
  for (const ov of await loadOverrides(root, page, user, role)) tree = applyOverride(tree, ov).tree;
  return tree;
}

export async function describePage(root, page, { user, role } = {}) {
  const lines = [];
  const walk = (node, name, depth) => {
    if (!node || typeof node !== "object") return;
    const data = node.data?.source ? ` (data: ${node.data.source}${node.data.params ? " " + JSON.stringify(node.data.params) : ""})` : "";
    const props = Object.fromEntries(Object.entries(node.props ?? {}).filter(([k]) => k !== "areas"));
    lines.push(`${"  ".repeat(depth)}${name}: ${node.ref}${data}${Object.keys(props).length ? " props " + JSON.stringify(props) : ""}`);
    if (node.props?.areas) lines.push(`${"  ".repeat(depth + 1)}areas: ${JSON.stringify(String(node.props.areas))}`);
    const kids = node.children;
    if (Array.isArray(kids)) kids.forEach(c => walk(c, splitRef(c?.ref)[0], depth + 1));
    else if (kids) for (const [k, c] of Object.entries(kids)) walk(c, k, depth + 1);
  };
  const tree = await currentTree(root, page, { user, role });
  walk(tree, splitRef(tree.ref)[0], 0);
  return `PAGE ${page} (user ${user ?? "none"}, role ${role ?? "none"})\n${lines.join("\n")}`;
}

const RULES = `- Use only the components, data sources and ops listed below; refs include the version (name@version).
- Respect types: a component bound to data must accept the type the source returns. Use only params listed for a source.
- Respect the role: never use a data source that is not listed (the role cannot read it).`;
const GRID_RULE = "- A grid with areas must place every child exactly once";
const reply = shape => `Answer ONLY with a JSON object, no prose:
  ${shape}
or, when the request cannot be satisfied with this catalog or this user's role:
  { "refuse": string }`;
const LANG = (...f) => `- Write ${f.map(x => `"${x}"`).join(", ")} (and "refuse") in the user's language.`;

export async function buildAgentPrompt(root, { page, user, role, request }) {
  const project = await loadProject(root);
  const system = `You modify a declarative UI page for one user by writing override patches.
${reply('{ "why": string, "patches": [ ...override ops... ] }')}

RULES
${RULES}
- Targets are existing child names or component names from the current page.
${GRID_RULE}: when you insert, remove or replace grid children, update areas too.
- Keep patches minimal: change only what the request asks for. Patches are appended to the user's existing ones.
${LANG("why")}

${describeCatalog(project, { role })}

CURRENT ${await describePage(root, page, { user, role })}`;
  return { system, user: request };
}

export const ANSWER_SKELETON = { ref: "layout/stack@1.0.0", children: [] };

export async function buildAskPrompt(root, { user, role, request }) {
  const project = await loadProject(root);
  const system = `You answer a user's question by composing a brand-new UI page from a catalog of components and data sources.
${reply('{ "title": string, "why": string, "patches": [ ...insert ops only... ] }')}

RULES
${RULES}
- Use ONLY "insert" ops, onto the page's root layout/stack (target "layout/stack") or onto a layout/grid or layout/card you inserted.
- Add a layout/card (with a title) or a layout/grid to group widgets as needed. To fill a grid, insert it with named children and areas in one node.
${GRID_RULE}.
- "title" names the page in a few words; "why" says briefly how the page answers the question.
${LANG("title", "why")}

${describeCatalog(project, { role })}

CURRENT PAGE answer (empty, user ${user ?? "none"}, role ${role ?? "none"})
layout/stack: layout/stack@1.0.0`;
  return { system, user: request };
}

export function parseAgentReply(text) {
  const s = String(text ?? "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidates = [fenced?.[1], s];
  for (const c of candidates) {
    if (!c) continue;
    const a = c.indexOf("{"), b = c.lastIndexOf("}");
    if (a < 0 || b <= a) continue;
    try {
      const v = JSON.parse(c.slice(a, b + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {}
  }
  throw new Error(`agent reply is not a JSON object: ${s.slice(0, 200)}`);
}

export async function runAgent(root, { page, user, role, request, complete }) {
  if (!user) return { ok: false, errors: ["user is required"], attempts: 0 };
  const name = `user-${user}`;
  const prompt = await buildAgentPrompt(root, { page, user, role, request });
  const file = join(root, "overrides", `${name}.yaml`);
  const existing = await exists(file) ? (await loadYaml(file)) ?? {} : {};
  const base = existing.extends === page ? existing.patches ?? [] : [];
  let message = prompt.user, reply, errors = [];
  for (let attempts = 1; attempts <= 2; attempts++) {
    const text = await complete({ system: prompt.system, user: message });
    try { reply = parseAgentReply(text); } catch (e) { errors = [e.message]; }
    if (reply?.refuse) return { ok: false, refuse: reply.refuse, reply, attempts };
    if (reply && !errors.length) {
      if (!Array.isArray(reply.patches)) errors = ["reply has no patches array"];
      else {
        const patches = reply.patches.reduce(mergePatch, base);
        const proposal = await propose(root, { name, author: user, role, override: { extends: page, why: reply.why, patches } });
        if (proposal.ok) return { ok: true, reply, proposal, attempts };
        errors = proposal.errors;
      }
    }
    if (attempts === 2) return { ok: false, errors, reply, attempts };
    message = `${prompt.user}\n\nThe previous patch was rejected: ${errors.join("; ")}. Fix it.`;
    reply = undefined; errors = [];
  }
}

// Pages as answers: compose a page in memory; nothing is written until keepAnswer or pinAnswer.
export async function runAsk(root, { user, role, request, complete }) {
  const prompt = await buildAskPrompt(root, { user, role, request });
  let message = prompt.user, reply, errors = [];
  for (let attempts = 1; attempts <= 2; attempts++) {
    const text = await complete({ system: prompt.system, user: message });
    try { reply = parseAgentReply(text); } catch (e) { errors = [e.message]; }
    if (reply?.refuse) return { ok: false, refuse: reply.refuse, reply, attempts };
    if (reply && !errors.length) {
      if (!Array.isArray(reply.patches)) errors = ["reply has no patches array"];
      else if (reply.patches.some(p => p?.op !== "insert")) errors = ["only insert ops are allowed"];
      else {
        const r = applyOverride(ANSWER_SKELETON, { name: "answer", patches: reply.patches });
        const resolved = await resolve(root, "answer", { user, role, tree: r.tree });
        errors = [...r.errors, ...resolved.errors].map(e => `${e.path}: ${e.message}`);
        if (!errors.length) return { ok: true, title: reply.title ?? "Answer", why: reply.why, tree: r.tree, resolved: { spec: resolved.spec, errors: resolved.errors }, attempts };
      }
    }
    if (attempts === 2) return { ok: false, errors, reply, attempts };
    message = `${prompt.user}\n\nThe previous page was rejected: ${errors.join("; ")}. Fix it.`;
    reply = undefined; errors = [];
  }
}

const slugify = s => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "answer";

export async function keepAnswer(root, { user, role, title, tree, why }) {
  const project = await loadProject(root);
  const errors = validateTree(tree, project, { role: role ?? null });
  if (errors.length) return { ok: false, errors: errors.map(e => `${e.path}: ${e.message}`) };
  const taken = new Set([...(await listPages(root)), ...(project.manifest.pages ?? [])]);
  const base = slugify(title); let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  await writeYaml(join(root, "pages", `${slug}.yaml`), { page: slug, title, owner: user, ...(why ? { why } : {}), layout: tree });
  const mfile = join(root, "manifest.yaml");
  const manifest = (await loadYaml(mfile)) ?? {};
  await writeYaml(mfile, { ...manifest, pages: [...(manifest.pages ?? []), slug] });
  return { ok: true, page: slug };
}

// The home's main container: the root, or the single grid it wraps.
function mainContainer(tree) {
  let node = tree;
  while (Array.isArray(node.children) && node.children.length === 1 && node.children[0]?.children && !Array.isArray(node.children[0].children)) node = node.children[0];
  return node;
}

export async function pinAnswer(root, { user, role, page, title, tree, why }) {
  if (!user) return { ok: false, errors: ["user is required"] };
  page ??= (await loadProject(root)).manifest.home;
  const name = `user-${user}`;
  const file = join(root, "overrides", `${name}.yaml`);
  const existing = await exists(file) ? (await loadYaml(file)) ?? {} : {};
  const base = existing.extends === page ? existing.patches ?? [] : [];
  const target = mainContainer(await currentTree(root, page, { user, role }));
  const card = { ref: "layout/card@1.0.0", props: { title: title ?? "Answer" }, children: structuredClone(tree.children ?? []) };
  const insert = { op: "insert", target: splitRef(target.ref)[0], node: card };
  if (target.children && !Array.isArray(target.children)) {
    let n = 1; while (`answer-${n}` in target.children) n++;
    insert.name = `answer-${n}`;
    const areas = String(target.props?.areas ?? "").trimEnd();
    const cols = areas ? areas.split("\n")[0].trim().split(/\s+/).length : 1;
    insert.area = `${areas ? areas + "\n" : ""}${Array(cols).fill(insert.name).join(" ")}\n`;
  }
  return propose(root, { name, author: user, role, override: { extends: page, why: why ?? `pinned: ${title ?? "answer"}`, patches: mergePatch(base, insert) } });
}
