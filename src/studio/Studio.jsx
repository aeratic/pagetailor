import { useCallback, useEffect, useState } from "react";
import { AppTab } from "./tabs/AppTab.jsx";
import { DataTab } from "./tabs/DataTab.jsx";
import { ComponentsTab } from "./tabs/ComponentsTab.jsx";
import { TokensTab } from "./tabs/TokensTab.jsx";
import { PeopleTab } from "./tabs/PeopleTab.jsx";
import { bar } from "./ui.jsx";

// Tabs over the project files. Each tab gets { project, reload, registry }; later tabs add entries here.
const TABS = [
  { id: "app", label: "App", Component: AppTab },
  { id: "data", label: "Data", Component: DataTab },
  { id: "components", label: "Components", Component: ComponentsTab },
  { id: "tokens", label: "Tokens", Component: TokensTab },
  { id: "people", label: "People", Component: PeopleTab },
];

export function useProject() {
  const [project, setProject] = useState(null), [error, setError] = useState(null);
  const reload = useCallback(() => fetch("/api/project").then(r => r.json()).then(p => { setProject(p); setError(null); }, e => setError(e.message)), []);
  useEffect(() => { reload(); const on = () => reload(); window.addEventListener("pt:files-changed", on); return () => window.removeEventListener("pt:files-changed", on); }, [reload]);
  return { project, reload, error };
}

export function Studio({ registry }) {
  const [tab, setTab] = useState(new URLSearchParams(location.search).get("tab") || "app");
  const { project, reload, error } = useProject();
  const go = id => { const q = new URLSearchParams(location.search); q.set("tab", id); history.replaceState(null, "", "?" + q); setTab(id); };
  const current = TABS.find(t => t.id === tab) ?? TABS[0];
  return <>
    <header style={{ ...bar, background: "var(--pt-color-surface)" }}>
      <strong>{project?.manifest?.app ?? "Studio"}</strong>
      {TABS.map(t => <button key={t.id} onClick={() => go(t.id)} style={{ fontWeight: current.id === t.id ? 700 : 400 }}>{t.label}</button>)}
      {error && <span style={{ color: "var(--pt-color-danger)" }}>{error}</span>}
    </header>
    {project && <current.Component project={project} reload={reload} registry={registry} />}
  </>;
}
