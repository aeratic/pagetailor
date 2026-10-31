import { useEffect, useState } from "react";
import { Preview } from "./Preview.jsx";
import { Studio } from "./Studio.jsx";
import { bar } from "./ui.jsx";

// Top level: "Preview" (the rendered app) | "Studio" (forms over the project files).
export function App({ registry }) {
  const [view, setView] = useState(new URLSearchParams(location.search).get("view") === "studio" ? "studio" : "preview");
  const go = v => { const q = new URLSearchParams(location.search); q.set("view", v); history.replaceState(null, "", "?" + q); setView(v); };
  // file changes: the preview reloads the tab, the studio refreshes its data without losing drafts
  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = () => { if (view === "preview") location.reload(); else window.dispatchEvent(new Event("pt:files-changed")); };
    return () => es.close();
  }, [view]);
  const tab = v => <button onClick={() => go(v)} style={{ fontWeight: view === v ? 700 : 400, border: "none", background: "none", cursor: "pointer", borderBottom: view === v ? "2px solid var(--pt-color-primary)" : "2px solid transparent", padding: "4px 8px" }}>{v === "preview" ? "Preview" : "Studio"}</button>;
  return <>
    <nav style={{ ...bar, padding: "4px 16px", gap: 4 }}>{tab("preview")}{tab("studio")}</nav>
    {view === "preview" ? <Preview registry={registry} /> : <Studio registry={registry} />}
  </>;
}
