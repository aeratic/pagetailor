import { useCallback, useEffect, useRef, useState } from "react";
import { Document, visit } from "yaml";

// Shared pieces of the Studio tabs. Plain inline styles, same look as the preview header.
export const bar = { display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--pt-color-border)", fontSize: 13, flexWrap: "wrap" };
export const danger = { color: "var(--pt-color-danger)" };
const label = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 };
export const section = { marginBottom: 20 };
export const h = { fontSize: 14, margin: "0 0 8px" };

export const api = async (path, method = "GET", body) => {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
export const errorText = r => (r.errors ?? [r.error ?? "request failed"]).join("; ");

export function Field({ label: text, value, onChange, placeholder, type = "text", hint }) {
  return <label style={label}>{text}
    <input type={type} value={value ?? ""} placeholder={placeholder} onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)} style={{ maxWidth: 320 }} />
    {hint && <span style={{ color: "var(--pt-color-muted)", fontSize: 12 }}>{hint}</span>}
  </label>;
}

export function Select({ label: text, value, options, onChange, empty }) {
  return <label style={label}>{text}
    <select value={value ?? ""} onChange={e => onChange(e.target.value)} style={{ maxWidth: 320 }}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map(o => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>;
}

export function Toggle({ label: text, checked, onChange }) {
  return <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />{text}
  </label>;
}

// items: array; render(item, i) -> row content; onRemove(i); onAdd() or addForm (input + button).
export function ListEditor({ items, render, onRemove, onAdd, addLabel = "+ add", addPlaceholder }) {
  const [text, setText] = useState("");
  const add = e => { e.preventDefault(); if (addPlaceholder !== undefined) { if (!text.trim()) return; if (onAdd(text.trim()) !== false) setText(""); } else onAdd(); };
  return <div style={{ fontSize: 13 }}>
    {items.map((item, i) => <div key={typeof item === "string" ? item : i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--pt-color-border)" }}>
      <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{render ? render(item, i) : String(item)}</div>
      {onRemove && <button onClick={() => onRemove(i)} title="remove">remove</button>}
    </div>)}
    {onAdd && <form onSubmit={add} style={{ display: "flex", gap: 6, marginTop: 8 }}>
      {addPlaceholder !== undefined && <input value={text} placeholder={addPlaceholder} onChange={e => setText(e.target.value)} />}
      <button type="submit">{addLabel}</button>
    </form>}
  </div>;
}

export function toYaml(value) {
  if (value == null) return "";
  const doc = new Document(value);
  visit(doc, { Scalar(_, node) { if (typeof node.value === "string" && node.value.includes("\n")) node.type = "BLOCK_LITERAL"; } });
  return doc.toString();
}

// Read-only YAML of the draft, collapsible, fixed at the bottom of the tab.
export function YamlPane({ name, value }) {
  const [open, setOpen] = useState(true);
  return <div style={{ borderTop: "1px solid var(--pt-color-border)", background: "var(--pt-color-surface)", fontSize: 12 }}>
    <button onClick={() => setOpen(!open)} style={{ border: "none", background: "none", cursor: "pointer", padding: "6px 16px", fontSize: 12 }}>{open ? "▾" : "▸"} {name}.yaml</button>
    {open && <pre style={{ margin: 0, padding: "0 16px 12px", maxHeight: 260, overflow: "auto" }}>{toYaml(value)}</pre>}
  </div>;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One project file as an editable draft: load, edit in memory, save with a why, undo, optional auto-save.
export function useFileDraft(name) {
  const [saved, setSaved] = useState(undefined), [draft, setDraft] = useState(undefined);
  const [status, setStatus] = useState(""), [errors, setErrors] = useState([]);
  const [why, setWhy] = useState("edited in studio"), [autoSave, setAutoSave] = useState(false);
  const dirty = saved !== undefined && !same(saved, draft);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const load = useCallback(async () => {
    const r = await api(`/api/files/${name}`);
    setSaved(r.value); setDraft(structuredClone(r.value)); setErrors([]);
  }, [name]);
  useEffect(() => { load(); }, [load]);
  // someone else changed the files: reload only when there is nothing unsaved here
  useEffect(() => { const on = () => { if (!dirtyRef.current) load(); }; window.addEventListener("pt:files-changed", on); return () => window.removeEventListener("pt:files-changed", on); }, [load]);
  const save = useCallback(async (value = draft) => {
    setStatus("saving…");
    const r = await api(`/api/files/${name}`, "PUT", { value, why: why || "edited in studio" });
    if (r.ok) { setSaved(structuredClone(value)); setErrors([]); setStatus(`saved v${r.entry.version}`); }
    else { setErrors(r.errors ?? [r.error ?? "save failed"]); setStatus(""); }
    return r;
  }, [name, draft, why]);
  const undo = useCallback(async () => {
    const r = await api(`/api/files/${name}/undo`, "POST");
    if (r.ok) { await load(); setStatus("undone"); } else setErrors(r.errors ?? [r.error]);
    return r;
  }, [name, load]);
  useEffect(() => {
    if (!autoSave || !dirty) return;
    const t = setTimeout(() => save(), 1500);
    return () => clearTimeout(t);
  }, [autoSave, dirty, draft, save]);
  // edit with a function of the current draft: update(d => { d.app = "x"; })
  const update = useCallback(fn => setDraft(d => { const n = structuredClone(d); fn(n); return n; }), []);
  return { name, saved, draft, setDraft, update, dirty, save, undo, reload: load, status, errors, setErrors, why, setWhy, autoSave, setAutoSave };
}

export function SaveBar({ file }) {
  return <div style={{ ...bar, borderBottom: "none", borderTop: "1px solid var(--pt-color-border)" }}>
    <button onClick={() => file.save()} disabled={!file.dirty}>Save</button>
    <button onClick={() => file.undo()}>Undo</button>
    <input value={file.why} onChange={e => file.setWhy(e.target.value)} placeholder="why" style={{ width: 200 }} />
    <Toggle label="auto-save" checked={file.autoSave} onChange={file.setAutoSave} />
    {file.dirty ? <span>unsaved changes</span> : <span style={{ color: "var(--pt-color-muted)" }}>{file.status}</span>}
    {file.errors.length > 0 && <span style={danger}>{file.errors.join("; ")}</span>}
  </div>;
}
