export default function Stack({ props, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: props.gap ?? "var(--pt-spacing-md)" }}>{children}</div>;
}
