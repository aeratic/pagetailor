import { Renderer, JSONUIProvider } from "@json-render/react";

// Components are written as ({ props, children, slots, emit }); json-render calls them with { element, ... }.
// element.props already has $state bindings resolved by the renderer.
export function wrapRegistry(components) {
  const out = {};
  for (const [name, C] of Object.entries(components))
    out[name] = ({ element, children, slots, emit, on, bindings, loading }) => <C props={element.props ?? {}} children={children} slots={slots} emit={emit} on={on} bindings={bindings} loading={loading} />;
  return out;
}

export function Fallback({ props }) {
  return <div style={{ border: "1px dashed var(--pt-color-danger, #C0392B)", color: "var(--pt-color-danger, #C0392B)", borderRadius: 8, padding: 12, fontSize: 13 }}>{props.reason}</div>;
}

// registry: { "charts/line@1.0.0": Component, ... }  resolved: output of resolve()
export function Page({ resolved, registry }) {
  const reg = wrapRegistry({ "pt/fallback": Fallback, ...registry });
  return (
    <JSONUIProvider registry={reg} initialState={resolved.spec.state} key={JSON.stringify(resolved.spec.state)}>
      <Renderer spec={resolved.spec} registry={reg} fallback={Fallback} />
    </JSONUIProvider>
  );
}

export { tokensToCss } from "./tokens.js";
export { EditorContext, EditableGrid, useEditor, swapAreas, mergePatch } from "./editor.jsx";
