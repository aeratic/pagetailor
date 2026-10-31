import { useEffect, useState } from "react";
import { Field, Select, ListEditor, YamlPane, SaveBar, useFileDraft, api, errorText, danger, section, h } from "../ui.jsx";

const SLUG = /^[a-z0-9-]+$/;
export const OPS = ["set-areas", "set-props", "set-data", "replace", "remove", "insert", "move"];
const FIELDS = {
  "set-areas": ["target", "areas"], "set-props": ["target", "props"], "set-data": ["target", "data"],
  replace: ["target", "with"], remove: ["target"], insert: ["target", "name", "node", "before", "area"], move: ["target", "to"],
};
const JSON_FIELDS = ["props", "data", "with", "node"];

// The fields a patch with this op needs, in display order.
export const patchFields = op => FIELDS[op] ?? ["target"];

// "set-areas layout/grid, remove kpi"
export const summarizePatches = patches => (patches ?? []).map(p => [p.op, p.target].filter(Boolean).join(" ")).join(", ");

// Child names and component names (ref without @version) found in a page tree, sorted and unique.
export function collectTargets(tree) {
  const out = new Set();
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (typeof node.ref === "string") out.add(node.ref.split("@")[0]);
    const kids = node.children;
    if (Array.isArray(kids)) kids.forEach(walk);
    else if (kids && typeof kids === "object") for (const [k, v] of Object.entries(kids)) { out.add(k); walk(v); }
  };
  walk(tree?.layout ?? tree);
  return [...out].sort();
}

const overrideNames = project => {
  const o = project?.overrides ?? [];
  return (Array.isArray(o) ? o.map(x => typeof x === "string" ? x : x.name) : Object.keys(o)).filter(Boolean).sort();
};
const small = { fontSize: 12, fontFamily: "monospace" };
const cell = { padding: "4px 6px", borderBottom: "1px solid var(--pt-color-border)", textAlign: "left", verticalAlign: "top" };

function JsonBox({ value, onChange }) {
  const [text, setText] = useState(JSON.stringify(value ?? {}));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(JSON.stringify(value ?? {})); setBad(false); }, [JSON.stringify(value)]);
  return <textarea rows={2} cols={40} value={text} style={{ ...small, borderColor: bad ? "var(--pt-color-danger)" : undefined }}
    onChange={e => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); } }} />;
}

function PatchRow({ patch, onChange, listId }) {
  const set = (k, v) => onChange({ ...patch, [k]: v });
  const changeOp = op => { const keep = patchFields(op); onChange(Object.fromEntries([["op", op], ...Object.entries(patch).filter(([k]) => keep.includes(k))])); };
  return <>
    <select value={patch.op} onChange={e => changeOp(e.target.value)}>{OPS.map(o => <option key={o}>{o}</option>)}</select>
    {patchFields(patch.op).map(f => <label key={f} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <span style={{ color: "var(--pt-color-muted)" }}>{f}</span>
      {f === "areas" ? <textarea rows={3} cols={30} value={patch.areas ?? ""} onChange={e => set("areas", e.target.value)} style={small} />
        : JSON_FIELDS.includes(f) ? <JsonBox value={patch[f]} onChange={v => set(f, v)} />
        : f === "to" ? <input type="number" value={patch.to ?? 0} onChange={e => set("to", Number(e.target.value))} style={{ width: 60 }} />
        : <input value={patch[f] ?? ""} list={f === "target" || f === "before" ? listId : undefined} style={{ width: 120 }}
            onChange={e => { const v = e.target.value; if (v || f === "target") set(f, v); else { const n = { ...patch }; delete n[f]; onChange(n); } }} />}
    </label>)}
  </>;
}

function OverrideEditor({ name, project, reload, onRemoved }) {
  const file = useFileDraft(`overrides/${name}`);
  const [targets, setTargets] = useState([]);
  const [note, setNote] = useState(null);
  const o = file.draft;
  const ext = o?.extends;
  useEffect(() => {
    if (!ext) { setTargets([]); return; }
    api(`/api/files/pages/${ext}`).then(r => setTargets(collectTargets(r.value))).catch(() => setTargets([]));
  }, [ext]);
  if (!o) return null;
  const patches = o.patches ?? [];
  const listId = `pt-targets-${name}`;
  const remove = async () => {
    if (!confirm(`Delete override "${name}"?`)) return;
    const r = await api(`/api/files/overrides/${name}`, "DELETE");
    if (!r.ok) { setNote(errorText(r)); return; }
    reload(); onRemoved();
  };
  return <div style={{ display: "flex", flexDirection: "column" }}>
    <div style={section}>
      <h3 style={h}>{name} <button onClick={remove} style={{ marginLeft: 8 }}>remove</button></h3>
      <Select label="extends" value={o.extends} options={project.manifest?.pages ?? []} onChange={v => file.update(d => { d.extends = v; })} />
      <Field label="why" value={o.why} onChange={v => file.update(d => { d.why = v; })} />
      {note && <p style={{ ...danger, fontSize: 13 }}>{note}</p>}
      <datalist id={listId}>{targets.map(t => <option key={t} value={t} />)}</datalist>
      <ListEditor items={patches} addLabel="+ patch"
        onAdd={() => file.update(d => { d.patches = [...(d.patches ?? []), { op: "remove", target: "" }]; })}
        onRemove={i => file.update(d => { d.patches.splice(i, 1); if (!d.patches.length) delete d.patches; })}
        render={(p, i) => <PatchRow patch={p} listId={listId} onChange={np => file.update(d => { d.patches[i] = np; })} />} />
    </div>
    <SaveBar file={file} />
    <YamlPane name={`overrides/${name}`} value={o} />
  </div>;
}

function OverridesPanel({ project, reload, selected, setSelected }) {
  const names = overrideNames(project);
  const roles = project.manifest?.roles ?? [];
  const [adding, setAdding] = useState(false), [kind, setKind] = useState("role"), [who, setWho] = useState("");
  const [note, setNote] = useState(null);
  const create = async () => {
    const id = kind === "role" ? who : who.trim();
    if (!id || !SLUG.test(id)) { setNote(`"${id}": use lowercase letters, digits and dashes`); return; }
    const name = `${kind}-${id}`;
    if (names.includes(name)) { setNote(`override "${name}" already exists`); return; }
    const r = await api(`/api/files/overrides/${name}`, "PUT", { value: { extends: project.manifest?.home ?? "home" }, why: `new override ${name}` });
    if (!r.ok) { setNote(errorText(r)); return; }
    setNote(null); setAdding(false); setWho(""); reload(); setSelected(name);
  };
  const group = (title, prefix) => <div style={{ marginBottom: 8 }}>
    <div style={{ color: "var(--pt-color-muted)", fontSize: 12 }}>{title}</div>
    {names.filter(n => n.startsWith(prefix)).map(n => <div key={n}>
      <button onClick={() => setSelected(n)} style={{ border: "none", background: "none", cursor: "pointer", fontWeight: n === selected ? 700 : 400, padding: "2px 0" }}>{n}</button>
    </div>)}
  </div>;
  return <div style={section}>
    <h3 style={h}>Overrides</h3>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      <div style={{ minWidth: 160, fontSize: 13 }}>
        {group("roles", "role-")}
        {group("users", "user-")}
        {!adding ? <button onClick={() => setAdding(true)}>+ override</button> : <div>
          <Select label="kind" value={kind} options={["role", "user"]} onChange={v => { setKind(v); setWho(""); }} />
          {kind === "role" ? <Select label="role" value={who} options={roles} empty="choose…" onChange={setWho} /> : <Field label="user" value={who} onChange={setWho} />}
          <button onClick={create}>create</button> <button onClick={() => { setAdding(false); setNote(null); }}>cancel</button>
        </div>}
        {note && <p style={{ ...danger, fontSize: 13 }}>{note}</p>}
      </div>
      <div style={{ flex: 1 }}>
        {selected && names.includes(selected)
          ? <OverrideEditor key={selected} name={selected} project={project} reload={reload} onRemoved={() => setSelected(null)} />
          : <p style={{ color: "var(--pt-color-muted)", fontSize: 13 }}>select an override</p>}
      </div>
    </div>
  </div>;
}

function PendingPanel({ reload }) {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const [user, setUser] = useState(params.get("user") || "admin"), [role, setRole] = useState(params.get("role") || "admin");
  const [rows, setRows] = useState([]), [note, setNote] = useState(null);
  const load = () => api("/api/pending").then(r => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const act = async (e, kind) => {
    const body = { name: e.name, version: e.version, approver: user, approverRole: role };
    if (kind === "reject") { const reason = prompt("Reason for rejecting?"); if (reason === null) return; body.reason = reason; }
    const r = await api(`/api/${kind}`, "POST", body);
    setNote(r.ok ? { ok: true, text: `${kind === "approve" ? "approved" : "rejected"} ${e.name} v${e.version}` } : { ok: false, text: errorText(r) });
    load(); reload();
  };
  return <div style={section}>
    <h3 style={h}>Pending proposals</h3>
    <div style={{ display: "flex", gap: 12 }}>
      <Field label="acting as user" value={user} onChange={setUser} />
      <Field label="role" value={role} onChange={setRole} />
    </div>
    {note && <p style={{ ...(note.ok ? {} : danger), fontSize: 13 }}>{note.text}</p>}
    {rows.length === 0 ? <p style={{ color: "var(--pt-color-muted)", fontSize: 13 }}>nothing pending</p> :
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead><tr>{["name", "version", "author", "why", "at", "patches", ""].map(c => <th key={c} style={cell}>{c}</th>)}</tr></thead>
        <tbody>{rows.map(e => <tr key={`${e.name}-${e.version}`}>
          <td style={cell}>{e.name}</td><td style={cell}>{e.version}</td><td style={cell}>{e.author}</td>
          <td style={cell}>{e.override?.why ?? e.why}</td><td style={cell}>{e.at}</td>
          <td style={cell}>{summarizePatches(e.override?.patches)}</td>
          <td style={{ ...cell, whiteSpace: "nowrap" }}><button onClick={() => act(e, "approve")}>Approve</button> <button onClick={() => act(e, "reject")}>Reject</button></td>
        </tr>)}</tbody>
      </table>}
  </div>;
}

function HistoryPanel({ project, reload }) {
  const names = overrideNames(project);
  const [name, setName] = useState(""), [rows, setRows] = useState([]), [note, setNote] = useState(null);
  const load = n => n ? api(`/api/history/${n}`).then(r => setRows(Array.isArray(r) ? [...r].sort((a, b) => b.version - a.version) : [])) : setRows([]);
  useEffect(() => { load(name); }, [name]);
  const roll = async v => {
    const r = await api("/api/rollback", "POST", { name, version: v });
    setNote(r.ok === false ? { ok: false, text: errorText(r) } : { ok: true, text: `rolled ${name} back to v${v}` });
    load(name); reload(); window.dispatchEvent(new Event("pt:files-changed"));
  };
  return <div style={section}>
    <h3 style={h}>History</h3>
    <Select label="override" value={name} options={names} empty="choose…" onChange={setName} />
    {note && <p style={{ ...(note.ok ? {} : danger), fontSize: 13 }}>{note.text}</p>}
    {name && (rows.length === 0 ? <p style={{ color: "var(--pt-color-muted)", fontSize: 13 }}>no history</p> :
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead><tr>{["version", "at", "author", "status", "why", "approvedFrom", ""].map(c => <th key={c} style={cell}>{c}</th>)}</tr></thead>
        <tbody>{rows.map(e => <tr key={e.version}>
          <td style={cell}>{e.version}</td><td style={cell}>{e.at}</td><td style={cell}>{e.author}</td>
          <td style={cell}>{e.status ?? "applied"}</td><td style={cell}>{e.override?.why ?? e.why}</td><td style={cell}>{e.approvedFrom ?? ""}</td>
          <td style={cell}>{(e.status ?? "applied") === "applied" && <button onClick={() => roll(e.version)}>Roll back to this</button>}</td>
        </tr>)}</tbody>
      </table>)}
  </div>;
}

// Overrides per role and user, proposals waiting for approval, and the history of each override.
export function PeopleTab({ project, reload }) {
  const [selected, setSelected] = useState(null);
  if (!project) return null;
  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 1000, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <OverridesPanel project={project} reload={reload} selected={selected} setSelected={setSelected} />
      <PendingPanel reload={reload} />
      <HistoryPanel project={project} reload={reload} />
    </main>
  </div>;
}
