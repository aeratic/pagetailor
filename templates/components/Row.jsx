export default function Row({ props, children }) {
  return <div style={{ display: "flex", flexDirection: "row", gap: props.gap ?? "var(--pt-spacing-md)", alignItems: "stretch" }}>{children}</div>;
}
