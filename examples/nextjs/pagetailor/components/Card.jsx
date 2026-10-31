export default function Card({ props, children }) {
  return (
    <section style={{ background: "var(--pt-color-surface)", border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-lg)" }}>
      {props.title && <h2 style={{ margin: "0 0 var(--pt-spacing-md)", fontSize: 18 }}>{props.title}</h2>}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--pt-spacing-md)" }}>{children}</div>
    </section>
  );
}
