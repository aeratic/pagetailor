import { useState } from "react";
import { Field, Select, Toggle, ListEditor, YamlPane, SaveBar, useFileDraft, api, errorText, danger, section, h } from "../ui.jsx";

const SLUG = /^[a-z0-9-]+$/;

// manifest.yaml: name, home, navigation, pages (with their files), roles and page owners.
export function AppTab({ project, reload }) {
  const file = useFileDraft("manifest");
  const [note, setNote] = useState(null);
  const m = file.draft;
  if (!m) return null;
  const pages = m.pages ?? [], roles = m.roles ?? [];
  const ownersOf = p => [].concat(m.owners?.[p] ?? []);

  const addPage = async slug => {
    if (!SLUG.test(slug)) { setNote(`"${slug}": use lowercase letters, digits and dashes`); return false; }
    if (pages.includes(slug)) { setNote(`page "${slug}" already exists`); return false; }
    const r = await api(`/api/files/pages/${slug}`, "PUT", { value: { page: slug, layout: { ref: "layout/stack@1.0.0" } }, why: `new page ${slug}` });
    if (!r.ok) { setNote(errorText(r)); return false; }
    const next = { ...structuredClone(m), pages: [...pages, slug] };
    file.setDraft(next);
    const s = await file.save(next);
    setNote(s.ok ? null : errorText(s)); reload();
  };
  const removePage = async i => {
    const slug = pages[i];
    if (slug === m.home) { setNote(`"${slug}" is the home page: choose another home first`); return; }
    const r = await api(`/api/files/pages/${slug}`, "DELETE");
    if (!r.ok) { setNote(errorText(r)); return; }
    const next = structuredClone(m);
    next.pages = pages.filter(p => p !== slug);
    if (next.owners) delete next.owners[slug];
    file.setDraft(next);
    const s = await file.save(next);
    setNote(s.ok ? null : errorText(s)); reload();
  };
  const addRole = role => {
    if (!SLUG.test(role)) { setNote(`"${role}": use lowercase letters, digits and dashes`); return false; }
    if (roles.includes(role)) { setNote(`role "${role}" already exists`); return false; }
    setNote(null); file.update(d => { d.roles = [...(d.roles ?? []), role]; });
  };
  const removeRole = i => {
    const role = roles[i];
    const usedBy = [
      ...pages.filter(p => ownersOf(p).includes(role)).map(p => `owner of page ${p}`),
      ...Object.entries(project.catalog ?? {}).filter(([, s]) => (s.roles ?? []).includes(role)).map(([n]) => `data source ${n}`),
    ];
    if (usedBy.length) { setNote(`role "${role}" is used: ${usedBy.join(", ")}`); return; }
    setNote(null); file.update(d => { d.roles = d.roles.filter(r => r !== role); });
  };
  const setOwner = (page, role, on) => file.update(d => {
    const cur = [].concat(d.owners?.[page] ?? []);
    const next = on ? [...cur, role] : cur.filter(r => r !== role);
    d.owners ??= {};
    if (next.length) d.owners[page] = next; else delete d.owners[page];
  });

  return <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 90px)" }}>
    <main style={{ padding: 16, maxWidth: 800, width: "100%", boxSizing: "border-box", margin: "0 auto", flex: 1 }}>
      <div style={section}>
        <Field label="name" value={m.app} onChange={v => file.update(d => { d.app = v; })} />
        <Select label="home" value={m.home} options={pages} onChange={v => file.update(d => { d.home = v; })} />
        <Select label="navigation" value={m.nav?.position ?? "left"} options={["left", "top"]} onChange={v => file.update(d => { d.nav = { ...(d.nav ?? {}), position: v }; })} />
      </div>
      {note && <p style={{ ...danger, fontSize: 13 }}>{note}</p>}
      <div style={section}>
        <h3 style={h}>Pages</h3>
        <ListEditor items={pages} addLabel="+ page" addPlaceholder="slug" onAdd={addPage} onRemove={removePage}
          render={p => <>
            <strong style={{ minWidth: 120 }}>{p}{p === m.home ? " (home)" : ""}</strong>
            <span style={{ color: "var(--pt-color-muted)" }}>owners</span>
            {roles.map(r => <Toggle key={r} label={r} checked={ownersOf(p).includes(r)} onChange={on => setOwner(p, r, on)} />)}
          </>} />
      </div>
      <div style={section}>
        <h3 style={h}>Roles</h3>
        <ListEditor items={roles} addLabel="+ role" addPlaceholder="role" onAdd={addRole} onRemove={removeRole} />
      </div>
    </main>
    <div style={{ position: "sticky", bottom: 0, background: "var(--pt-color-background)" }}>
      <SaveBar file={file} />
      <YamlPane name="manifest" value={m} />
    </div>
  </div>;
}
