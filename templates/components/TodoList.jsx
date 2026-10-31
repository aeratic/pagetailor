export default function TodoList({ props }) {
  const items = Array.isArray(props.data) ? props.data : [];
  return (
    <div style={{ border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-md)", height: "100%", boxSizing: "border-box" }}>
      {props.title && <div style={{ fontWeight: 600, marginBottom: 8 }}>{props.title}</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(t => <li key={t.id ?? t.title} style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--pt-color-muted)" : "inherit" }}>{t.done ? "☑" : "☐"} {t.title}</li>)}
      </ul>
    </div>
  );
}
