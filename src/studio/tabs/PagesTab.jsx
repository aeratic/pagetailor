import { useState } from "react";
import { Select, Toggle, ListEditor, YamlPane, SaveBar, useFileDraft, danger, section, h } from "../ui.jsx";
import { notationToProp } from "./ComponentsTab.jsx";
import { validateTree, typeAccepts, splitRef } from "../../validator.js";

// A path addresses a node from the root: [] is the root, [0, "chart"] is child "chart" of the first child.
export function nodeAt(tree, path) {
  let n = tree;
  for (const k of path) { n = n?.children?.[k]; if (n === undefined) return undefined; }
  return n;
}
// Copy of tree with the node at path replaced by fn(node) (fn may also mutate and return nothing).
export function updateAt(tree, path, fn) {
  if (!path.length) { const n = structuredClone(tree); const r = fn(n); return r === undefined ? n : r; }
  const copy = structuredClone(tree), parent = nodeAt(copy, path.slice(0, -1)), k = path.at(-1);
  const r = fn(parent.children[k]);
  if (r !== undefined) parent.children[k] = r;
  return copy;
}
export const schemaOf = (registry, ref) => registry?.[splitRef(ref ?? "")[0]]?.props;

// Catalog sources whose returned type the component accepts; none for containers or components without `accepts`.
export function acceptedSources(catalog, component) {
  if (!component?.accepts || component.container) return [];
  return Object.keys(catalog ?? {}).filter(s => catalog[s]?.returns && typeAccepts(component.accepts, catalog[s].returns));
}

// Keep the props the new schema still declares; without a new schema everything is kept.
export function migrateProps(props, oldSchema, newSchema) {
  if (!newSchema) return { ...(props ?? {}) };
  return Object.fromEntries(Object.entries(props ?? {}).filter(([k]) => k in newSchema));
}

// areas: text of rows, cells separated by spaces, "." is an empty cell.
const rows = areas => String(areas ?? "").split("\n").map(r => r.trim().split(/\s+/).filter(Boolean)).filter(r => r.length);
const text = rs => rs.length ? rs.map(r => r.join(" ")).join("\n") + "\n" : "";
export const appendAreaRow = (areas, name) => {
  const rs = rows(areas), cols = Math.max(1, ...rs.map(r => r.length));
  return text([...rs, Array(cols).fill(name)]);
};
// The name's cells become "."; rows left all empty are dropped.
export const removeAreaName = (areas, name) => text(rows(areas).map(r => r.map(c => c === name ? "." : c)).filter(r => r.some(c => c !== ".")));
export const renameAreaName = (areas, from, to) => text(rows(areas).map(r => r.map(c => c === from ? to : c)));

const defaultFor = (key, t) => t.type === "number" ? 0 : t.type === "boolean" ? false : t.type === "enum" ? (t.values?.[0] ?? "")
  : t.type.endsWith("[]") ? [] : key === "areas" && t.type === "text" ? ".\n" : "";
// New node with the required props filled in; containers get children ({} when they place them by areas).
export function newNode(name, version, entry) {
  const node = { ref: `${name}@${version}` };
  const props = Object.fromEntries(Object.entries(entry?.props ?? {}).map(([k, s]) => [k, notationToProp(s)]).filter(([, t]) => !t.optional).map(([k, t]) => [k, defaultFor(k, t)]));
  if (Object.keys(props).length) node.props = props;
  if (entry?.container) node.children = "areas" in (entry.props ?? {}) ? {} : [];
  return node;
}

export const refOptions = registry => Object.entries(registry ?? {}).flatMap(([n, e]) => Object.keys(e.versions ?? {}).map(v => `${n}@${v}`));
const pathKey = p => JSON.stringify(p);
const listText = v => [].concat(v ?? []).join(", ");

function Tree({ node, path, sel, onSel, name }) {
  if (!node) return null;
  const on = pathKey(path) === pathKey(sel);
  const kids = Array.isArray(node.children) ? node.children.map((c, i) => [i, c, null]) : Object.entries(node.children ?? {}).map(([k, c]) => [k, c, k]);
  return <div style={{ paddingLeft: path.length ? 14 : 0 }}>
    <button onClick={() => onSel(path)} style={{ border: "none", background: on ? "var(--pt-color-surface)" : "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, textAlign: "left", fontWeight: on ? 700 : 400 }}>
      {name && <span style={{ color: "var(--pt-color-muted)" }}>{name}: </span>}{node.ref}
      {node.data?.source && <span style={{ color: "var(--pt-color-muted)" }}> ← {node.data.source}</span>}
    </button>
    {kids.map(([k, c, n]) => <Tree key={k} node={c} path={[...path, k]} sel={sel} onSel={onSel} name={n} />)}
  </div>;
}

function PropInput({ k, t, value, onChange }) {
  const lab = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 };
  const clear = t.optional && value !== undefined && <button onClick={() => onChange(undefined)} style={{ alignSelf: "flex-start", fontSize: 11 }}>clear</button>;
  const title = <span>{k}{t.optional ? "" : " *"}</span>;
  if (t.type === "boolean") return <div style={{ marginBottom: 12, display: "flex", gap: 8 }}><Toggle label={k} checked={value} onChange={onChange} />{clear}</div>;
  if (t.type === "enum") return <label style={lab}>{title}<select value={value ?? ""} onChange={e => onChange(e.target.value || undefined)} style={{ maxWidth: 320 }}>
    <option value="">{t.optional ? "(none)" : "choose…"}</option>{t.values.map(v => <option key={v}>{v}</option>)}</select></label>;
  const input = t.type === "text" ? <textarea rows={4} value={value ?? ""} onChange={e => onChange(e.target.value)} style={{ maxWidth: 420, fontFamily: "monospace" }} />
    : t.type === "number" ? <input type="number" value={value ?? ""} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} style={{ maxWidth: 320 }} />
    : t.type.endsWith("[]") ? <input value={listText(value)} placeholder="comma separated" onChange={e => onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean).map(s => t.type === "number[]" ? Number(s) : s))} style={{ maxWidth: 320 }} />
    : <input value={value ?? ""} onChange={e => onChange(e.target.value)} style={{ maxWidth: 320 }} />;
  return <label style={lab}>{title}{input}{clear}</label>;
}

// Free JSON for components without a props schema; applied only when it parses.
function JsonProps({ value, onChange }) {
  const [txt, setTxt] = useState(JSON.stringify(value ?? {}, null, 2)), [bad, setBad] = useState(false);
  return <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 }}>props (JSON)
    <textarea rows={6} value={txt} style={{ maxWidth: 420, fontFamily: "monospace" }} onChange={e => {
      setTxt(e.target.value);
      try { const v = JSON.parse(e.target.value || "{}"); setBad(false); onChange(v); } catch { setBad(true); }
    }} />{bad && <span style={danger}>not valid JSON</span>}
  </label>;
}

// pages/<slug>.yaml: the tree of components, their props, data bindings and grid areas.
export function PagesTab({ project }) {
  const pages = project.pages ?? [];
  const [slug, setSlug] = useState(() => { const p = new URLSearchParams(location.search).get("page"); return pages.includes(p) ? p : pages[0]; });
  const pick = s => { const q = new URLSearchParams(location.search); q.set("page", s); history.replaceState(null, "", "?" + q); setSlug(s); };
  if (!slug) return <main style={{ padding: 16 }}>no pages yet, add one in the App tab</main>;
  return <PageEditor key={slug} slug={slug} pages={pages} pick={pick} project={project} />;
}

function PageEditor({ slug, pages, pick, project }) {
  const file = useFileDraft(`pages/${slug}`);
  const [sel, setSel] = useState([]);
  const page = file.draft;
  if (!page) return null;
  const { registry = {}, catalog = {} } = project;
  const tree = page.layout;
  const node = nodeAt(tree, sel) ?? tree;
  const path = nodeAt(tree, sel) ? sel : [];
  const errors = tree ? validateTree(tree, { registry, catalog }) : [{ path: "root", message: "page has no layout" }];
  const edit = fn => file.update(d => { d.layout = updateAt(d.layout, path, fn); });
  const [name] = splitRef(node?.ref ?? "");
  const entry = registry[name], schema = entry?.props;
  const refs = refOptions(registry);

  const setRef = ref => edit(n => {
    const [nn, v] = splitRef(ref), next = registry[nn];
    if (nn === name) { n.ref = ref; return; }
    const fresh = newNode(nn, v, next), props = { ...(fresh.props ?? {}), ...migrateProps(n.props, schema, next?.props) };
    n.ref = ref;
    if (Object.keys(props).length) n.props = props; else delete n.props;
    if (next?.container) { delete n.data; if (!n.children) n.children = fresh.children; }
    else { delete n.children; if (n.data && !acceptedSources(catalog, next).includes(n.data.source)) delete n.data; }
  });
  const setProp = (k, v) => edit(n => { n.props = { ...(n.props ?? {}) }; if (v === undefined) delete n.props[k]; else n.props[k] = v; if (!Object.keys(n.props).length) delete n.props; });
  const removeNode = () => {
    const parentPath = path.slice(0, -1), k = path.at(-1);
    file.update(d => { d.layout = updateAt(d.layout, parentPath, p => {
      if (Array.isArray(p.children)) p.children.splice(k, 1);
      else { delete p.children[k]; if (p.props?.areas !== undefined) p.props.areas = removeAreaName(p.props.areas, k); }
    }); });
    setSel(parentPath);
  };
  const named = node?.children && !Array.isArray(node.children);
  const sources = acceptedSources(catalog, entry), src = catalog[node?.data?.source];
  const newRef = r => { const [n, v] = splitRef(r); return newNode(n, v, registry[n]); };

  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 1000, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <Select label="page" value={slug} options={pages} onChange={pick} />
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ ...section, flex: "1 1 300px" }}>
          <h3 style={h}>Tree</h3>
          <Tree node={tree} path={[]} sel={path} onSel={setSel} />
          {errors.length > 0 && <ul style={{ ...danger, fontSize: 12, paddingLeft: 16 }}>{errors.map((e, i) => <li key={i}>{e.path}: {e.message}</li>)}</ul>}
        </div>
        {node && <div style={{ ...section, flex: "1 1 360px" }}>
          <h3 style={h}>Node {path.length ? path.join(" / ") : "(root)"}</h3>
          <Select label="component" value={node.ref} options={refs.includes(node.ref) ? refs : [node.ref, ...refs]} onChange={setRef} />
          {schema ? Object.entries(schema).map(([k, s]) => <PropInput key={pathKey(path) + k} k={k} t={notationToProp(s)} value={node.props?.[k]} onChange={v => setProp(k, v)} />)
            : <JsonProps key={pathKey(path) + node.ref} value={node.props} onChange={v => edit(n => { if (v && Object.keys(v).length) n.props = v; else delete n.props; })} />}
          {entry?.accepts && !entry.container && <>
            <Select label={`data (${entry.accepts})`} value={node.data?.source} options={sources} empty="(none)"
              onChange={s => edit(n => { if (s) n.data = { source: s }; else delete n.data; })} />
            {src && Object.entries(src.params ?? {}).map(([k, allowed]) => {
              const v = node.data.params?.[k];
              const set = val => edit(n => { n.data.params = { ...(n.data.params ?? {}) }; if (val === "" || val === undefined) delete n.data.params[k]; else n.data.params[k] = val; if (!Object.keys(n.data.params).length) delete n.data.params; });
              return Array.isArray(allowed) ? <Select key={k} label={`param ${k}`} value={v} options={allowed.map(String)} empty="(default)" onChange={set} />
                : <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 }}>param {k}<input value={v ?? ""} onChange={e => set(e.target.value)} style={{ maxWidth: 320 }} /></label>;
            })}
          </>}
          {named && <NamedChildren node={node} refs={refs} edit={edit} newRef={newRef} />}
          {Array.isArray(node.children) && <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>children</span>
            <ListEditor items={node.children} onRemove={i => edit(n => { n.children.splice(i, 1); })}
              render={(c, i) => <>
                <span style={{ flex: 1 }}>{c.ref}</span>
                <button disabled={i === 0} onClick={() => edit(n => { [n.children[i - 1], n.children[i]] = [n.children[i], n.children[i - 1]]; })}>↑</button>
                <button disabled={i === node.children.length - 1} onClick={() => edit(n => { [n.children[i + 1], n.children[i]] = [n.children[i], n.children[i + 1]]; })}>↓</button>
              </>} />
            <select value="" onChange={e => e.target.value && edit(n => { n.children.push(newRef(e.target.value)); })} style={{ marginTop: 8 }}>
              <option value="">+ child…</option>{refs.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>}
          {path.length > 0 && <button onClick={removeNode} style={danger}>remove node</button>}
        </div>}
      </div>
    </main>
    <div style={{ position: "sticky", bottom: 0, background: "var(--pt-color-background)" }}>
      <SaveBar file={file} />
      <YamlPane name={slug} value={page} />
    </div>
  </div>;
}

// Children placed by name (grid areas): rename, remove, add with a new full-width row.
function NamedChildren({ node, refs, edit, newRef }) {
  const [nm, setNm] = useState(""), [ref, setRef] = useState(""), [note, setNote] = useState(null);
  const names = Object.keys(node.children), hasAreas = node.props?.areas !== undefined;
  const ok = n => /^[A-Za-z_][\w-]*$/.test(n) && !names.includes(n);
  const rename = (from, to) => {
    if (!ok(to)) { setNote(`"${to}": not a valid or free name`); return; }
    setNote(null);
    edit(n => { n.children = Object.fromEntries(Object.entries(n.children).map(([k, c]) => [k === from ? to : k, c])); if (hasAreas) n.props.areas = renameAreaName(n.props.areas, from, to); });
  };
  const add = e => {
    e.preventDefault();
    if (!ok(nm)) { setNote(`"${nm}": not a valid or free name`); return; }
    if (!ref) { setNote("choose a component"); return; }
    setNote(null);
    edit(n => { n.children[nm] = newRef(ref); n.props = { ...(n.props ?? {}), areas: appendAreaRow(n.props?.areas, nm) }; });
    setNm(""); setRef("");
  };
  return <div style={{ marginBottom: 12 }}>
    <span style={{ fontSize: 13 }}>children by name</span>
    {note && <p style={{ ...danger, fontSize: 12 }}>{note}</p>}
    <ListEditor items={names} onRemove={i => edit(n => { delete n.children[names[i]]; if (hasAreas) n.props.areas = removeAreaName(n.props.areas, names[i]); })}
      render={k => <><strong style={{ minWidth: 80 }}>{k}</strong><span style={{ flex: 1 }}>{node.children[k].ref}</span>
        <button onClick={() => { const to = prompt("New name", k); if (to && to !== k) rename(k, to); }}>rename</button></>} />
    <form onSubmit={add} style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input value={nm} placeholder="name" onChange={e => setNm(e.target.value)} style={{ width: 100 }} />
      <select value={ref} onChange={e => setRef(e.target.value)}><option value="">component…</option>{refs.map(r => <option key={r}>{r}</option>)}</select>
      <button type="submit">+ child</button>
    </form>
  </div>;
}
