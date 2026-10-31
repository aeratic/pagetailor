// A dependency-free SVG line chart for timeseries<money>: [{ date, value }]
export default function LineChart({ props }) {
  const pts = Array.isArray(props.data) ? props.data : [];
  const W = 600, H = 180, pad = 24;
  const vals = pts.map(p => p.value), lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
  const x = i => pad + (i / Math.max(pts.length - 1, 1)) * (W - 2 * pad);
  const y = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  return (
    <div style={{ border: "1px solid var(--pt-color-border)", borderRadius: "var(--pt-radius)", padding: "var(--pt-spacing-md)" }}>
      {props.title && <div style={{ fontWeight: 600, marginBottom: 8 }}>{props.title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={props.title}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--pt-color-border)" />
        <path d={d} fill="none" stroke="var(--pt-color-primary)" strokeWidth="2" />
        {pts.length > 0 && <text x={pad} y={14} fontSize="11" fill="var(--pt-color-muted)">{pts[0].date}</text>}
        {pts.length > 1 && <text x={W - pad} y={14} fontSize="11" textAnchor="end" fill="var(--pt-color-muted)">{pts.at(-1).date}</text>}
      </svg>
    </div>
  );
}
