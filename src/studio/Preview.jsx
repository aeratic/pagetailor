import { useCallback, useEffect, useState } from "react";
import { Page, EditorContext, useEditor } from "../client.jsx";

// The rendered app with user/role selectors, the reorder editor and the two agent boxes.
export function Preview({ registry }) {
  const q = new URLSearchParams(location.search);
  const [page, setPage] = useState(q.get("page") || "__home__");
  const [user, setUser] = useState(q.get("user") || "");
  const [role, setRole] = useState(q.get("role") || "");
  const [state, setState] = useState(null);
  const load = useCallback(() => fetch(`/api/page/${page}?user=${user}&role=${role}`).then(r => r.json()).then(setState), [page, user, role]);
  useEffect(() => { load(); }, [load]);
  // keep page/user/role in the URL: the file watcher reloads the tab after an override is written
  useEffect(() => { const u = new URLSearchParams(location.search); u.set("page", page); u.set("user", user); u.set("role", role); history.replaceState(null, "", "?" + u); }, [page, user, role]);
  const editor = useEditor({ page: state?.page, user, role, why: "reordered in the editor", onApplied: r => { if (!r.pending) load(); } });
  const [ask, setAsk] = useState(""), [agent, setAgent] = useState(null);
  const sendAsk = async e => {
    e.preventDefault(); if (!ask.trim()) return;
    setAgent({ text: "thinking…" });
    try {
      const r = await (await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: state.page, user, role: role || undefined, request: ask }) })).json();
      if (r.ok) setAgent({ text: (r.proposal.pending ? "sent for approval: " : "applied: ") + (r.reply.why ?? "") });
      else setAgent({ error: true, text: r.refuse ?? (r.errors ?? [r.error ?? "agent failed"]).join("; ") });
    } catch (err) { setAgent({ error: true, text: err.message }); }
  };
  const [question, setQuestion] = useState(""), [answer, setAnswer] = useState(null), [answerStatus, setAnswerStatus] = useState(null);
  const post = (path, b) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  const sendQuestion = async e => {
    e.preventDefault(); if (!question.trim()) return;
    setAnswer(null); setAnswerStatus({ text: "composing…" });
    try {
      const r = await post("/api/ask", { user, role: role || undefined, request: question });
      if (r.ok) { setAnswer(r); setAnswerStatus(null); }
      else setAnswerStatus({ error: true, text: r.refuse ?? (r.errors ?? [r.error ?? "ask failed"]).join("; ") });
    } catch (err) { setAnswerStatus({ error: true, text: err.message }); }
  };
  const answerBody = () => ({ user, role: role || undefined, title: answer.title, tree: answer.tree, why: answer.why });
  const keep = async () => {
    const r = await post("/api/ask/keep", answerBody());
    if (r.ok) { setAnswer(null); setAnswerStatus(null); setPage(r.page); } else setAnswerStatus({ error: true, text: (r.errors ?? [r.error]).join("; ") });
  };
  const pin = async () => {
    const r = await post("/api/ask/pin", answerBody());
    setAnswerStatus(r.ok ? { text: r.pending ? "sent for approval" : "applied to home" } : { error: true, text: (r.errors ?? [r.error]).join("; ") });
  };
  if (!state) return null;
  const pages = state.manifest.pages, roles = state.manifest.roles ?? [];
  return <>
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--pt-color-border)", background: "var(--pt-color-surface)", fontSize: 13 }}>
      <strong>{state.manifest.app}</strong>
      <label>page <select value={state.page} onChange={e => setPage(e.target.value)}>{pages.map(p => <option key={p}>{p}</option>)}</select></label>
      <label>user <input value={user} placeholder="giulia" onChange={e => setUser(e.target.value)} style={{ width: 90 }} /></label>
      <label>role <select value={role} onChange={e => setRole(e.target.value)}><option value="">(none)</option>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
      <button onClick={() => editor.setEditing(!editor.editing)} style={{ fontWeight: editor.editing ? 700 : 400 }}>{editor.editing ? "Done editing" : "Edit layout"}</button>
      {editor.status === "saving" && <span>saving…</span>}
      {editor.status === "pending" && <span>sent for approval</span>}
      {editor.status === "error" && <span style={{ color: "var(--pt-color-danger)" }}>{editor.errors.join("; ")}</span>}
      <form onSubmit={sendAsk} style={{ display: "flex", gap: 6 }}><input value={ask} placeholder="Change this page…" onChange={e => setAsk(e.target.value)} style={{ width: 220 }} /><button type="submit">Ask</button></form>
      <form onSubmit={sendQuestion} style={{ display: "flex", gap: 6 }}><input value={question} placeholder="Ask…" onChange={e => setQuestion(e.target.value)} style={{ width: 220 }} /><button type="submit">Ask</button></form>
      {agent && <span style={{ color: agent.error ? "var(--pt-color-danger)" : undefined }}>{agent.text}</span>}
      {state.errors.length > 0 && <span style={{ color: "var(--pt-color-danger)" }}>{state.errors.length} problem(s), see console</span>}
    </header>
    {(answer || answerStatus) && <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--pt-color-border)", fontSize: 13 }}>
      {answer && <><strong>{answer.title}</strong><span>{answer.why}</span><button onClick={keep}>Keep as page</button><button onClick={pin}>Pin to home</button><button onClick={() => { setAnswer(null); setAnswerStatus(null); }}>Back</button></>}
      {answerStatus && <span style={{ color: answerStatus.error ? "var(--pt-color-danger)" : undefined }}>{answerStatus.text}</span>}
    </div>}
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>{answer
      ? <Page resolved={{ ...state, spec: answer.resolved.spec, errors: answer.resolved.errors }} registry={registry} />
      : <EditorContext.Provider value={{ editing: editor.editing, propose: editor.propose }}><Page resolved={state} registry={registry} /></EditorContext.Provider>}</main>
  </>;
}
