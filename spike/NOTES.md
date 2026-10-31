# Spike: json-render as the rendering layer

Date: 2026-10-14. Versions: @json-render/core 0.21.1, @json-render/react 0.21.1, react 19.2.3, zod 4.3.6, node 26.

Run: `npx esbuild run.jsx --bundle --platform=node --format=esm --outfile=run.mjs --external:react --external:react-dom --external:zod --external:yaml --external:@json-render/* && node run.mjs`

## Verified

| Question | Result |
| --- | --- |
| Component names like `charts/line@1.0.0` as catalog keys | Works, validateSpec passes |
| Array and multiline string props (`names: string[]`, `areas`) | Works |
| Grid with named areas via `names[]` + ordered children | Renders correct `grid-template-areas` and `grid-area` |
| Per-user override (`set-areas`, `replace`, `remove`) applied on the YAML tree before resolving | Works |
| Data fetched server-side into `spec.state.data`, bound with `{ $state }` | Works |
| Role check on data sources, invalid node replaced by `pt/fallback` with reason | Works, rest of the page renders |
| History as numbered JSON versions, rollback by re-resolving an older version | Works |
| `diffToPatches` from core for readable diffs between versions | Works (array-level replace, not element-level) |
| `repeat` + `$item` (issue #292) | Works when `repeat` is on the container and the template is its child |
| renderToString in Node (no browser) | Works with `JSONUIProvider` (StateProvider alone throws: needs ActionProvider) |

## Decisions

- `experimental_composeSpec` is AI-driven composition through Vercel AI Gateway, not a spec merge. Not useful for overrides. Our override ops stay on the YAML tree.
- Overrides are applied on the YAML tree, not on the json-render spec: the ops are readable (`set-areas`, `replace`, `remove`, `set-props`) and independent from element ids.
- Renderer must be wrapped in `JSONUIProvider`, not in `StateProvider` alone.
- Pin exact versions of @json-render/* and zod.

## Verdict

Go. No blocker found. The resolver is ~90 lines; the json-render side is a catalog + registry built from registry.yaml.
