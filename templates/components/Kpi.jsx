const fmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export default function Kpi({ props }) {
  return (
    <div style={{ padding: "var(--pt-spacing-md)", border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", height: "100%", boxSizing: "border-box" }}>
      <div style={{ color: "var(--pt-color-muted)", fontSize: 13 }}>{props.label}</div>
      <div style={{ fontSize: 32, fontWeight: 600, color: "var(--pt-color-primary)" }}>{typeof props.data === "number" ? fmt.format(props.data) : "–"}</div>
    </div>
  );
}
