import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { mergePatch } from "./overrides.js";
export { mergePatch };

// Reorder editor: drag a grid cell onto another to swap their area names, written as a set-areas patch.
export const EditorContext = createContext({ editing: false, propose: null });

// Swap every occurrence of area names a and b; keeps line breaks, normalises spacing inside a row.
export function swapAreas(areas, a, b) {
  return String(areas).trim().split("\n")
    .map(l => l.trim().split(/\s+/).map(n => n === a ? b : n === b ? a : n).join(" "))
    .join("\n") + "\n";
}

// props: the grid's props (areas, names, __pt); cells: one rendered child per entry of props.names.
export function EditableGrid({ props, cells, style }) {
  const { editing, propose } = useContext(EditorContext);
  const [dragging, setDragging] = useState(null), [over, setOver] = useState(null);
  const names = props.names ?? [];
  const on = editing && typeof propose === "function";
  const drop = to => {
    const from = dragging; setDragging(null); setOver(null);
    if (!from || from === to) return;
    propose({ op: "set-areas", target: props.__pt?.name ?? "layout/grid", areas: swapAreas(props.areas, from, to) });
  };
  return (
    <div style={style}>
      {cells.map((k, i) => {
        const name = names[i];
        const cell = { gridArea: name, minWidth: 0 };
        if (!on || !name) return <div key={name ?? i} style={cell}>{k}</div>;
        return (
          <div key={name} draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", name); setDragging(name); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onDragOver={e => { e.preventDefault(); if (over !== name) setOver(name); }}
            onDragLeave={() => setOver(o => o === name ? null : o)}
            onDrop={e => { e.preventDefault(); drop(name); }}
            style={{ ...cell, cursor: "grab", borderRadius: 8, outline: over === name && dragging !== name ? "2px solid var(--pt-color-primary, #2E6BE6)" : "1px dashed var(--pt-color-border, #999)", outlineOffset: 2, opacity: dragging === name ? 0.5 : 1 }}>
            {k}
          </div>
        );
      })}
    </div>
  );
}

// status: "idle" | "saving" | "pending" | "error"; errors holds the gate errors.
export function useEditor({ page, user, role, why, onApplied } = {}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("idle"), [errors, setErrors] = useState([]), [pending, setPending] = useState(null);
  const name = `user-${user}`;
  const propose = useCallback(async patch => {
    if (!user) { setStatus("error"); setErrors(["set a user to save layout changes"]); return; }
    setStatus("saving"); setErrors([]);
    try {
      const current = await (await fetch(`/api/override/${encodeURIComponent(name)}`)).json();
      const override = { extends: page, why, patches: mergePatch(current.extends === page ? current.patches ?? [] : [], patch) };
      const r = await (await fetch("/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, author: user, role: role || undefined, override }) })).json();
      if (!r.ok) { setStatus("error"); setErrors(r.errors ?? [r.error ?? "propose failed"]); return; }
      if (r.pending) { setPending(r.entry); setStatus("pending"); }
      else { setPending(null); setStatus("idle"); }
      onApplied?.(r);
    } catch (e) { setStatus("error"); setErrors([e.message]); }
  }, [page, user, role, why, name, onApplied]);
  useEffect(() => { setStatus("idle"); setErrors([]); setPending(null); }, [page, user, role]);
  return { editing, setEditing, propose, status, errors, pending };
}
