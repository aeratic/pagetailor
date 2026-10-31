"use client";
import { useEffect, useState } from "react";
import { Page } from "@aeratic/pagetailor/client";
import { registry } from "../pagetailor/components/index.js";

export default function PageClient({ page, user, role }) {
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    const q = new URLSearchParams({ user, role });
    fetch(`/api/page/${page}?${q}`).then(r => r.json()).then(setResolved);
  }, [page, user, role]);
  return <>
    <header style={{ display: "flex", gap: 16, padding: "10px 16px", borderBottom: "1px solid var(--pt-color-border)", background: "var(--pt-color-surface)", fontSize: 13 }}>
      <strong>pagetailor</strong><span>page: {page}</span><span>user: {user}</span><span>role: {role}</span>
      {resolved?.errors.length > 0 && <span style={{ color: "var(--pt-color-danger)" }}>{resolved.errors.length} problem(s)</span>}
    </header>
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>{resolved ? <Page resolved={resolved} registry={registry} /> : "loading..."}</main>
  </>;
}
