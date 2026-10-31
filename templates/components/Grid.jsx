import { Children } from "react";
import { EditableGrid } from "@aeratic/pagetailor/client";

// props.areas is a multiline string like CSS grid-template-areas; props.names lists the children in order.
// Inside an EditorContext with editing on, cells can be dragged onto each other to swap areas.
export default function Grid({ props, children }) {
  const rows = String(props.areas).trim().split("\n").map(l => l.trim().split(/\s+/));
  const cols = Math.max(...rows.map(r => r.length));
  const style = { display: "grid", gap: "var(--pt-spacing-md)", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateAreas: rows.map(r => `"${r.join(" ")}"`).join(" ") };
  return <EditableGrid props={props} cells={Children.toArray(children)} style={style} />;
}
