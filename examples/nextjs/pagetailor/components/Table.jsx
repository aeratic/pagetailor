export default function Table({ props }) {
  const rows = Array.isArray(props.data) ? props.data : [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <div style={{ border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-md)", height: "100%", boxSizing: "border-box" }}>
      {props.title && <div style={{ fontWeight: 600, marginBottom: 8 }}>{props.title}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead><tr>{cols.map(c => <th key={c} style={{ textAlign: "left", padding: "4px 6px", color: "var(--pt-color-muted)", fontWeight: 500, borderBottom: "1px solid var(--pt-color-border)" }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c} style={{ padding: "4px 6px" }}>{String(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
