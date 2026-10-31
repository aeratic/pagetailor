import { useState } from "react";
import { Field, Toggle, ListEditor, YamlPane, SaveBar, useFileDraft, api, danger, section, h } from "../ui.jsx";

export const SOURCE_NAME = /^[a-z0-9_.]+$/;
export const BASE_TYPES = ["money", "number", "string", "timeseries<money>", "timeseries<number>", "table<any>", "list<task>"];

// Suggestions for returns/accepts: the base list plus every type already used in catalog and registry.
export function typeSuggestions(catalog = {}, registry = {}) {
  const used = [...Object.values(catalog ?? {}).map(s => s?.returns), ...Object.values(registry ?? {}).map(c => c?.accepts)];
  return [...new Set([...BASE_TYPES, ...used.filter(t => typeof t === "string" && t)])];
}

// roles: ["*"] means everyone; toggling a single role drops "*".
export function rolesToggle(roles, role, on) {
  const cur = [].concat(roles ?? []).filter(r => r !== "*");
  if (role === "*") return on ? ["*"] : [];
  return on ? [...new Set([...cur, role])] : cur.filter(r => r !== role);
}

export const valuesToText = values => [].concat(values ?? []).join(", ");
export const textToValues = text => String(text).split(",").map(v => v.trim()).filter(Boolean);

// Every node of a page tree (layout plus children, either array or named map).
export function* walkNodes(node) {
  if (!node || typeof node !== "object") return;
  yield node;
  const kids = node.children;
  for (const c of Array.isArray(kids) ? kids : Object.values(kids ?? {})) yield* walkNodes(c);
}
export const sourcesUsedIn = page => [...walkNodes(page?.layout)].map(n => n.data?.source).filter(Boolean);

// Pages (by slug) whose tree matches pred(node); reads every page file.
export async function pagesUsing(slugs, pred) {
  const hits = [];
  for (const slug of slugs ?? []) {
    const r = await api(`/api/files/pages/${slug}`);
    if ([...walkNodes(r.value?.layout)].some(pred)) hits.push(slug);
  }
  return hits;
}

// data-catalog.yaml: typed data sources, their params and the roles allowed to read them.
export function DataTab({ project, reload }) {
  const file = useFileDraft("data-catalog");
  const [note, setNote] = useState(null), [info, setInfo] = useState(null), [open, setOpen] = useState(null);
  const [fresh, setFresh] = useState([]); // added since load: scaffolded on the next Save
  const c = file.draft;
  if (!c) return null;
  const names = Object.keys(c), roles = project.manifest?.roles ?? [];
  const types = typeSuggestions(c, project.registry);

  const add = name => {
    if (!SOURCE_NAME.test(name)) { setNote(`"${name}": use lowercase letters, digits, dots and underscores`); return false; }
    if (name in c) { setNote(`source "${name}" already exists`); return false; }
    setNote(null); setOpen(name); setFresh(f => [...f, name]);
    file.update(d => { d[name] = { description: "", returns: "", roles: ["*"] }; });
  };
  const remove = async i => {
    const name = names[i];
    const used = await pagesUsing(project.pages, n => n.data?.source === name);
    if (used.length) { setNote(`source "${name}" is used by page ${used.join(", ")}`); return; }
    setNote(null); setFresh(f => f.filter(n => n !== name)); file.update(d => { delete d[name]; });
  };
  const save = async () => {
    const r = await file.save();
    if (!r.ok) return;
    let stub = false;
    const todo = fresh.filter(n => n in c); setFresh([]);
    for (const name of todo) {
      const s = await api("/api/scaffold/source", "POST", { name });
      if (s.created) stub = true; else if (s.error) setNote(s.error);
    }
    if (stub) setInfo("stub added to data/sources.mjs");
    reload();
  };
  const set = (name, fn) => file.update(d => { fn(d[name]); });
  const params = name => Object.entries(c[name].params ?? {});

  const row = name => {
    const s = c[name], everyone = [].concat(s.roles ?? []).includes("*");
    return <div style={{ width: "100%" }}>
      <button onClick={() => setOpen(open === name ? null : name)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}>{open === name ? "▾" : "▸"} <strong>{name}</strong></button>
      <span style={{ color: "var(--pt-color-muted)", marginLeft: 8 }}>{s.returns}</span>
      {open === name && <div style={{ padding: "8px 0 0 16px" }}>
        <Field label="description" value={s.description} onChange={v => set(name, x => { x.description = v; })} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 }}>returns
          <input list="pt-data-types" value={s.returns ?? ""} onChange={e => set(name, x => { x.returns = e.target.value; })} style={{ maxWidth: 320 }} />
        </label>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>params</span>
          <ListEditor items={params(name)} addLabel="+ param" addPlaceholder="param name"
            onAdd={p => { if (!/^[A-Za-z_][\w]*$/.test(p)) { setNote(`"${p}": not a valid param name`); return false; } set(name, x => { x.params = { ...(x.params ?? {}), [p]: [] }; }); }}
            onRemove={i => set(name, x => { delete x.params[params(name)[i][0]]; if (!Object.keys(x.params).length) delete x.params; })}
            render={([p, vals]) => <>
              <strong style={{ minWidth: 100 }}>{p}</strong>
              <input value={valuesToText(vals)} placeholder="allowed values, comma separated" onChange={e => set(name, x => { x.params[p] = textToValues(e.target.value); })} style={{ width: 260 }} />
            </>} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "var(--pt-color-muted)", fontSize: 13 }}>roles</span>
          <Toggle label="everyone (*)" checked={everyone} onChange={on => set(name, x => { x.roles = rolesToggle(x.roles, "*", on); })} />
          {!everyone && roles.map(r => <Toggle key={r} label={r} checked={[].concat(s.roles ?? []).includes(r)} onChange={on => set(name, x => { x.roles = rolesToggle(x.roles, r, on); })} />)}
        </div>
      </div>}
    </div>;
  };

  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 800, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <datalist id="pt-data-types">{types.map(t => <option key={t} value={t} />)}</datalist>
      {note && <p style={{ ...danger, fontSize: 13 }}>{note}</p>}
      {info && <p style={{ fontSize: 13 }}>{info}</p>}
      <div style={section}>
        <h3 style={h}>Data sources</h3>
        <ListEditor items={names} addLabel="+ source" addPlaceholder="name, e.g. sales.total" onAdd={add} onRemove={remove} render={row} />
      </div>
    </main>
    <div style={{ position: "sticky", bottom: 0, background: "var(--pt-color-background)" }}>
      <SaveBar file={{ ...file, save, dirty: file.dirty || fresh.length > 0 }} />
      <YamlPane name="data-catalog" value={c} />
    </div>
  </div>;
}
