import { useEffect } from "react";
import { Field, ListEditor, YamlPane, SaveBar, useFileDraft, section, h } from "../ui.jsx";
import { tokensToCss } from "../../tokens.js";

const NAME = /^[a-z0-9-]+$/;
const FONT_STACKS = [
  "Inter, system-ui, sans-serif",
  "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  "Helvetica Neue, Arial, sans-serif",
  "Georgia, Cambria, Times New Roman, serif",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
];

export const isHex = s => typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

// Immutable set: returns a copy of obj with value at path ("a.b" or ["a","b"]).
export function setPath(obj, path, value) {
  const keys = Array.isArray(path) ? path : String(path).split(".");
  if (!keys.length) return value;
  const [k, ...rest] = keys;
  const base = obj && typeof obj === "object" ? obj : {};
  return { ...base, [k]: rest.length ? setPath(base[k], rest, value) : value };
}

// #abc -> #aabbcc, so <input type="color"> accepts it
const fullHex = s => isHex(s) ? (s.length === 4 ? "#" + [...s.slice(1)].map(c => c + c).join("") : s) : "#000000";

// tokens.yaml: colors, spacing, radius and font, previewed live on the whole Studio.
export function TokensTab() {
  const file = useFileDraft("tokens");
  const t = file.draft;

  useEffect(() => {
    if (!t) return;
    let el = document.getElementById("pt-tokens-draft");
    if (!el) { el = document.createElement("style"); el.id = "pt-tokens-draft"; document.head.appendChild(el); }
    el.textContent = tokensToCss(t);
  }, [t]);
  useEffect(() => () => document.getElementById("pt-tokens-draft")?.remove(), []);

  if (!t) return null;
  const colors = Object.keys(t.color ?? {}), spacing = Object.keys(t.spacing ?? {});
  const set = (path, v) => file.setDraft(d => setPath(d, path, v));
  const drop = (group, key) => file.update(d => { delete d[group][key]; });
  const add = (group, initial) => name => {
    if (!NAME.test(name) || (t[group] ?? {})[name] !== undefined) return false;
    set([group, name], initial);
  };

  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 800, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <div style={{ ...section, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {colors.map(c => <div key={c} style={{ textAlign: "center", fontSize: 11 }}>
          <div style={{ width: 48, height: 32, background: t.color[c], border: "1px solid var(--pt-color-border)", borderRadius: 4 }} />{c}
        </div>)}
      </div>
      <div style={{ ...section, background: "var(--pt-color-surface)", border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-md)", fontFamily: "var(--pt-font-base)", fontSize: "var(--pt-font-size)", color: "var(--pt-color-text)", maxWidth: 360 }}>
        <strong>Sample card</strong>
        <p style={{ color: "var(--pt-color-muted)", margin: "var(--pt-spacing-sm) 0" }}>A muted line of secondary text.</p>
        <button style={{ background: "var(--pt-color-primary)", color: "#fff", border: "none", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-sm) var(--pt-spacing-md)" }}>Primary</button>
      </div>
      <div style={section}>
        <h3 style={h}>Colors</h3>
        <ListEditor items={colors} addLabel="+ color" addPlaceholder="name" onAdd={add("color", "#000000")} onRemove={i => drop("color", colors[i])}
          render={c => <>
            <strong style={{ minWidth: 120 }}>{c}</strong>
            <input type="color" value={fullHex(t.color[c])} onChange={e => set(["color", c], e.target.value)} />
            <input value={t.color[c] ?? ""} onChange={e => set(["color", c], e.target.value)} style={{ width: 100, ...(isHex(t.color[c]) ? {} : { borderColor: "var(--pt-color-danger)" }) }} />
          </>} />
      </div>
      <div style={section}>
        <h3 style={h}>Spacing</h3>
        <ListEditor items={spacing} addLabel="+ spacing" addPlaceholder="name" onAdd={add("spacing", 8)} onRemove={i => drop("spacing", spacing[i])}
          render={s => <>
            <strong style={{ minWidth: 120 }}>{s}</strong>
            <input type="number" min={0} value={t.spacing[s]} onChange={e => set(["spacing", s], Number(e.target.value))} style={{ width: 80 }} /> px
          </>} />
      </div>
      <div style={section}>
        <h3 style={h}>Radius</h3>
        <Field label="radius (px)" type="number" value={t.radius} onChange={v => set(["radius"], v)} />
      </div>
      <div style={section}>
        <h3 style={h}>Font</h3>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 12 }}>base family
          <input list="pt-font-stacks" value={t.font?.base ?? ""} onChange={e => set(["font", "base"], e.target.value)} style={{ maxWidth: 320 }} />
          <datalist id="pt-font-stacks">{FONT_STACKS.map(f => <option key={f} value={f} />)}</datalist>
        </label>
        <Field label="size (px)" type="number" value={t.font?.size} onChange={v => set(["font", "size"], v)} />
      </div>
    </main>
    <div style={{ position: "sticky", bottom: 0, background: "var(--pt-color-background)" }}>
      <SaveBar file={file} />
      <YamlPane name="tokens" value={t} />
    </div>
  </div>;
}
