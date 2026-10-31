import React from "react";
import { renderToString } from "react-dom/server";
import { z } from "zod";
import { defineCatalog, validateSpec, diffToPatches, applySpecPatch } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { defineRegistry, Renderer, JSONUIProvider } from "@json-render/react";
import { resolve, commit, versionOf, applyOverride } from "./resolver.js";
import { parse } from "yaml";
import { readFileSync, rmSync } from "node:fs";

// 1. catalog: names with slash and @version, array + multiline props, named-children grid via names[]
const data = z.any().nullable();
const catalog = defineCatalog(schema, {
  components: {
    "layout/card@1.0.0":   { props: z.object({ title: z.string(), names: z.array(z.string()).nullable() }), slots: ["default"], description: "card" },
    "layout/grid@1.0.0":   { props: z.object({ areas: z.string(), names: z.array(z.string()) }), slots: ["default"], description: "css grid with named areas" },
    "charts/line@1.0.0":   { props: z.object({ title: z.string().nullable(), data }), description: "line chart" },
    "tables/simple@1.0.0": { props: z.object({ data }), description: "table" },
    "kpi/number@1.0.0":    { props: z.object({ data }), description: "kpi" },
    "todo/list@1.0.0":     { props: z.object({ data }), description: "todo" },
    "pt/fallback":         { props: z.object({ reason: z.string() }), description: "invalid node placeholder" },
    "Row":                 { props: z.object({ label: z.string() }), description: "repeat test" },
  },
  actions: {},
});
const { registry } = defineRegistry(catalog, {
  components: {
    "layout/card@1.0.0": ({ props, children }) => <section data-card={props.title}>{children}</section>,
    "layout/grid@1.0.0": ({ props, children }) => {
      const kids = React.Children.toArray(children);
      return <div style={{ display: "grid", gridTemplateAreas: props.areas.trim().split("\n").map(l => `"${l.trim()}"`).join(" ") }}>
        {kids.map((k, i) => <div key={i} style={{ gridArea: props.names[i] }}>{k}</div>)}
      </div>;
    },
    "charts/line@1.0.0":   ({ props }) => <b>chart:{props.title}:{JSON.stringify(props.data)}</b>,
    "tables/simple@1.0.0": ({ props }) => <i>table:{JSON.stringify(props.data)}</i>,
    "kpi/number@1.0.0":    ({ props }) => <strong>kpi:{props.data}</strong>,
    "todo/list@1.0.0":     ({ props }) => <u>todo:{JSON.stringify(props.data)}</u>,
    "pt/fallback":         ({ props }) => <em data-invalid>{props.reason}</em>,
    "Row":                 ({ props }) => <li>{props.label}</li>,
  },
});
const fetchers = {
  "sales.trend": async () => [1, 2, 3], "sales.by_region": async () => [{ r: "N", v: 10 }], "sales.total": async () => 42,
  "tasks.mine": async () => [{ t: "a" }], "stock.levels": async () => [{ sku: "X", qty: 5 }],
};
const render = (spec) => renderToString(<JSONUIProvider registry={registry} initialState={spec.state}><Renderer spec={spec} registry={registry} /></JSONUIProvider>);
const show = (label, out) => console.log(`\n### ${label}\n`, out);

const root = "./pt";
// base page, role marketing, no override
let r = await resolve(root, "home", "nobody", "marketing", fetchers);
show("validateSpec on base", validateSpec(r.spec));
show("base (marketing)", render(r.spec));

// giulia: areas override
r = await resolve(root, "home", "giulia", "marketing", fetchers);
show("giulia errors", r.errors); show("giulia", render(r.spec));

// marco: replace chart with stock table; role magazzino -> sales.* forbidden -> fallbacks
r = await resolve(root, "home", "marco", "magazzino", fetchers);
show("marco errors", r.errors); show("marco", render(r.spec));

// history + rollback
rmSync(`${root}/.history`, { recursive: true, force: true });
const base = parse(readFileSync(`${root}/overrides/user-giulia.yaml`, "utf8"));
const v1 = commit(root, "giulia", base);
const v2 = commit(root, "giulia", { ...base, why: "agent: kpi removed", patches: [...base.patches, { op: "remove", target: "kpi" }] });
show("history versions", [v1, v2]);
const specV1 = (await (async () => { const t = applyOverride(parse(readFileSync(`${root}/pages/home.yaml`, "utf8")).layout, versionOf(root, "giulia", 1)); return t; })());
const specV2 = applyOverride(parse(readFileSync(`${root}/pages/home.yaml`, "utf8")).layout, versionOf(root, "giulia", 2));
show("diff v1->v2 (json-render diffToPatches)", diffToPatches(specV1, specV2));
show("rollback = re-resolve from v1, kpi present again:", Object.keys(specV1.children[0].children));

// repeat + $item bug test (#292)
const rep = { root: "l", elements: {
  l: { type: "layout/card@1.0.0", props: { title: "rep", names: null }, children: ["row"], repeat: { statePath: "/items" } },
  row: { type: "Row", props: { label: { $item: "name" } } } },
  state: { items: [{ name: "uno" }, { name: "due" }] } };
show("repeat/$item", render(rep));
