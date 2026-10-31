import { Children } from "react";

// props.areas is a multiline string like CSS grid-template-areas; props.names lists the children in order.
export default function Grid({ props, children }) {
  const rows = String(props.areas).trim().split("\n").map(l => l.trim().split(/\s+/));
  const cols = Math.max(...rows.map(r => r.length));
  const kids = Children.toArray(children);
  return (
    <div style={{ display: "grid", gap: "var(--pt-spacing-md)", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateAreas: rows.map(r => `"${r.join(" ")}"`).join(" ") }}>
      {kids.map((k, i) => <div key={props.names?.[i] ?? i} style={{ gridArea: props.names?.[i], minWidth: 0 }}>{k}</div>)}
    </div>
  );
}
