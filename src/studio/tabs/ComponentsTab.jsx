import { useState } from "react";
import { Field, Toggle, ListEditor, YamlPane, SaveBar, useFileDraft, api, danger, section, h } from "../ui.jsx";
import { typeSuggestions, pagesUsing, valuesToText, textToValues } from "./DataTab.jsx";

export const COMPONENT_NAME = /^[a-z0-9-]+\/[a-z0-9-]+$/;
export const SEMVER = /^\d+\.\d+\.\d+$/;
export const PROP_TYPES = ["string", "number", "boolean", "text", "string[]", "number[]", "enum"];

// Same naming as files.js pascalName (kept here so the tab has no server import).
export const pascalName = name => String(name).split(/[^a-zA-Z0-9]+/).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join("");

// { type, optional, values } <-> registry notation like "enum[a,b]?" or "string?".
export function propToNotation({ type, optional, values }) {
  const base = type === "enum" ? `enum[${[].concat(values ?? []).join(",")}]` : type;
  return optional ? `${base}?` : base;
}
export function notationToProp(str) {
  let s = String(str ?? "").trim();
  const optional = s.endsWith("?");
  if (optional) s = s.slice(0, -1).trim();
  const m = /^enum\[(.*)\]$/.exec(s);
  if (m) return { type: "enum", optional, values: m[1].split(",").map(v => v.trim()).filter(Boolean) };
  return { type: PROP_TYPES.includes(s) ? s : "string", optional };
}

const semverKey = v => v.split(".").map(Number);
export function latestVersion(versions) {
  return Object.keys(versions ?? {}).filter(v => SEMVER.test(v)).sort((a, b) => {
    const x = semverKey(a), y = semverKey(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  }).at(-1);
}
// Next minor of the latest version, as a suggestion for "+ version".
export function nextVersion(versions) {
  const l = latestVersion(versions);
  if (!l) return "1.0.0";
  const [a, b] = semverKey(l);
  return `${a}.${b + 1}.0`;
}
export const newComponentEntry = name => ({ description: "", props: {}, versions: { "1.0.0": { impl: `./${pascalName(name)}.jsx` } } });

// components/registry.yaml: components, what data they accept, their props and versions.
export function ComponentsTab({ project, reload }) {
  const file = useFileDraft("components/registry");
  const [note, setNote] = useState(null), [info, setInfo] = useState(null), [open, setOpen] = useState(null);
  const [fresh, setFresh] = useState([]); // added since load: scaffolded on the next Save
  const reg = file.draft;
  if (!reg) return null;
  const names = Object.keys(reg);
  const types = typeSuggestions(project.catalog, reg);

  const add = name => {
    if (!COMPONENT_NAME.test(name)) { setNote(`"${name}": use group/name with lowercase letters, digits and dashes`); return false; }
    if (name in reg) { setNote(`component "${name}" already exists`); return false; }
    setNote(null); setOpen(name); setFresh(f => [...f, name]);
    file.update(d => { d[name] = newComponentEntry(name); });
  };
  const remove = async i => {
    const name = names[i];
    const used = await pagesUsing(project.pages, n => typeof n.ref === "string" && n.ref.split("@")[0] === name);
    if (used.length) { setNote(`component "${name}" is used by page ${used.join(", ")}`); return; }
    setNote(null); setFresh(f => f.filter(n => n !== name)); file.update(d => { delete d[name]; });
  };
  const save = async () => {
    const r = await file.save();
    if (!r.ok) return;
    const todo = fresh.filter(n => n in reg); setFresh([]);
    const made = [];
    for (const name of todo) {
      const s = await api("/api/scaffold/component", "POST", { name, props: reg[name].props ?? {}, container: !!reg[name].container });
      if (s.created) made.push(`components/${pascalName(name)}.jsx`); else if (s.error) setNote(s.error);
    }
    if (made.length) setInfo(`created ${made.join(", ")}, open it to write the React`);
    reload();
  };
  const set = (name, fn) => file.update(d => { fn(d[name]); });
  const props = name => Object.entries(reg[name].props ?? {});
  const setProp = (name, key, patch) => set(name, x => { x.props[key] = propToNotation({ ...notationToProp(x.props[key]), ...patch }); });

  const addVersion = name => v => {
    if (!SEMVER.test(v)) { setNote(`"${v}": use a version like 1.2.0`); return false; }
    if (v in (reg[name].versions ?? {})) { setNote(`version ${v} already exists`); return false; }
    const impl = reg[name].versions?.[latestVersion(reg[name].versions)]?.impl ?? `./${pascalName(name)}.jsx`;
    setNote(null); set(name, x => { x.versions = { ...(x.versions ?? {}), [v]: { impl } }; });
  };

  const row = name => {
    const e = reg[name];
    return <div style={{ width: "100%" }}>
      <button onClick={() => setOpen(open === name ? null : name)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}>{open === name ? "▾" : "▸"} <strong>{name}</strong></button>
      <span style={{ color: "var(--pt-color-muted)", marginLeft: 8 }}>{e.container ? "container" : e.accepts}</span>
      {open === name && <div style={{ padding: "8px 0 0 16px" }}>
        <Field label="description" value={e.description} onChange={v => set(name, x => { x.description = v; })} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 }}>accepts
          <input list="pt-component-types" value={e.accepts ?? ""} disabled={!!e.container} onChange={ev => set(name, x => { if (ev.target.value) x.accepts = ev.target.value; else delete x.accepts; })} style={{ maxWidth: 320 }} />
        </label>
        <div style={{ marginBottom: 12 }}>
          <Toggle label="container (has children, accepts no data)" checked={e.container} onChange={on => set(name, x => { if (on) { x.container = true; delete x.accepts; } else delete x.container; })} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>props</span>
          <ListEditor items={props(name)} addLabel="+ prop" addPlaceholder="prop name"
            onAdd={p => {
              if (!/^[A-Za-z_$][\w$]*$/.test(p) || ["data", "names", "__pt"].includes(p)) { setNote(`"${p}": not a valid prop name`); return false; }
              if (p in (e.props ?? {})) { setNote(`prop "${p}" already exists`); return false; }
              setNote(null); set(name, x => { x.props = { ...(x.props ?? {}), [p]: "string?" }; });
            }}
            onRemove={i => set(name, x => { delete x.props[props(name)[i][0]]; })}
            render={([p, notation]) => { const t = notationToProp(notation); return <>
              <strong style={{ minWidth: 100 }}>{p}</strong>
              <select value={t.type} onChange={ev => setProp(name, p, { type: ev.target.value, values: ev.target.value === "enum" ? (t.values ?? []) : undefined })}>
                {PROP_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <Toggle label="optional" checked={t.optional} onChange={on => setProp(name, p, { optional: on })} />
              {t.type === "enum" && <input value={valuesToText(t.values)} placeholder="values, comma separated" onChange={ev => setProp(name, p, { values: textToValues(ev.target.value) })} style={{ width: 200 }} />}
              <code style={{ color: "var(--pt-color-muted)" }}>{notation}</code>
            </>; }} />
        </div>
        <div>
          <span style={{ fontSize: 13 }}>versions</span>
          <ListEditor items={Object.entries(e.versions ?? {})} addLabel="+ version" addPlaceholder={nextVersion(e.versions)} onAdd={addVersion(name)}
            render={([v, x]) => <><strong style={{ minWidth: 100 }}>{v}</strong><code>{x?.impl}</code></>} />
        </div>
      </div>}
    </div>;
  };

  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 800, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <datalist id="pt-component-types">{types.map(t => <option key={t} value={t} />)}</datalist>
      {note && <p style={{ ...danger, fontSize: 13 }}>{note}</p>}
      {info && <p style={{ fontSize: 13 }}>{info}</p>}
      <div style={section}>
        <h3 style={h}>Components</h3>
        <ListEditor items={names} addLabel="+ component" addPlaceholder="group/name, e.g. kpi/delta" onAdd={add} onRemove={remove} render={row} />
      </div>
    </main>
    <div style={{ position: "sticky", bottom: 0, background: "var(--pt-color-background)" }}>
      <SaveBar file={{ ...file, save, dirty: file.dirty || fresh.length > 0 }} />
      <YamlPane name="registry" value={reg} />
    </div>
  </div>;
}
