# @aeratic/pagetailor

[![npm](https://img.shields.io/npm/v/@aeratic/pagetailor)](https://www.npmjs.com/package/@aeratic/pagetailor) [![test](https://github.com/aeratic/pagetailor/actions/workflows/test.yml/badge.svg)](https://github.com/aeratic/pagetailor/actions/workflows/test.yml) [![license](https://img.shields.io/npm/l/@aeratic/pagetailor)](LICENSE)

Pages as data. Define your app's pages in YAML, bind them to a typed catalog of components and data sources, tailor them per role and per person with small patches, and let an AI agent compose them through a validation gate. Rendering is done by [json-render](https://github.com/vercel-labs/json-render).

## Start here

```bash
# 1. Install and create the project
npm install @aeratic/pagetailor react react-dom
npx pagetailor init

# 2. Check that everything fits together
npx pagetailor validate

# 3. Run the preview and the Studio
npx pagetailor dev
#   http://localhost:4747/?user=giulia&role=marketing   the page as Giulia sees it
#   http://localhost:4747/?role=magazzino               the same page for the warehouse role
#   http://localhost:4747/?view=studio                  visual editor of the whole project

# 4. Enable the AI agent with any provider: Anthropic, OpenAI, Gemini, Groq, Mistral, DeepSeek, xAI, OpenRouter, Ollama…
ANTHROPIC_API_KEY=sk-... npx pagetailor dev
OPENAI_API_KEY=sk-... npx pagetailor dev
PAGETAILOR_PROVIDER=ollama PAGETAILOR_MODEL=llama3.3 npx pagetailor dev

# 5. After editing components/registry.yaml, regenerate the component index
npx pagetailor registry
```

Three things to try in the first ten minutes:

- **Change one user's layout.** Open `pagetailor/overrides/user-giulia.yaml`, move a row in `areas`, save: the browser reloads with her new page. Nobody else's page changes.
- **Break something on purpose.** Put a data source that does not exist in `pages/home.yaml`. `validate` refuses it, and in the preview that widget becomes a red box with the reason while the rest of the page still renders.
- **Ask the agent.** Type "put the KPI at the top" in the *Change this page…* box. The patch it writes is an ordinary override, checked by the same validator as your own edits.

What pagetailor is not: a CMS, a page builder for end users, or an authenticated server. It is an engine for declarative pages with a gate that humans, the Studio and agents all go through. `pagetailor dev` writes project files over an unauthenticated API and binds to localhost only.

## CLI

| Command | What it does |
| --- | --- |
| `pagetailor init [--force]` | create `pagetailor/` with manifest, tokens, data catalog, a sample page, overrides and base components |
| `pagetailor validate` | check manifest, pages and overrides against the component registry and the data catalog; exit 1 on problems |
| `pagetailor registry` | write `pagetailor/components/index.js` exporting every component in `registry.yaml` |
| `pagetailor dev [--port 4747] [--host 127.0.0.1]` | preview server with live reload and the Studio; pass `--host 0.0.0.0` to expose it |
| `pagetailor help`, `pagetailor --version` | this text, the version |

## Contents

- [What `init` creates](#what-init-creates)
- [A page](#a-page), [An override](#an-override), [The gate](#the-gate), [Component props](#component-props)
- [Next.js](#nextjs), [Caching](#caching)
- [Proposals and approval](#proposals-and-approval), [Reorder editor](#reorder-editor)
- [The agent](#the-agent), [Pages as answers](#pages-as-answers)
- [Studio](#studio), [Status](#status)

## What `init` creates

```
pagetailor/
  manifest.yaml         pages, home, navigation, roles
  tokens.yaml           design tokens -> CSS variables --pt-*
  data-catalog.yaml     data sources: params, returned type, allowed roles
  data/sources.mjs      one async function per source (demo data)
  pages/home.yaml       a page: tree of components, data bindings, grid with named areas
  overrides/            user-giulia.yaml, role-magazzino.yaml: patches over a page, with a `why`
  components/           registry.yaml + base components (yours to edit)
```

## A page

```yaml
page: home
layout:
  ref: layout/card@1.0.0
  props: { title: "Dashboard" }
  children:
    - ref: layout/grid@1.0.0
      props:
        areas: |
          chart chart
          table kpi
          table todo
      children:
        chart: { ref: charts/line@1.0.0,   data: { source: analytics.revenue, params: { period: 30d } } }
        table: { ref: tables/simple@1.0.0, data: { source: sales.by_region } }
        kpi:   { ref: kpi/number@1.0.0,    data: { source: sales.total } }
        todo:  { ref: todo/list@1.0.0,     data: { source: tasks.mine } }
```

## An override

```yaml
# overrides/user-giulia.yaml
extends: home
why: "Reports every Monday, wants the KPI on top"
patches:
  - { op: set-areas, target: layout/grid, areas: "kpi kpi\nchart chart\ntable todo\n" }
```

Ops: `set-areas`, `set-props`, `set-data`, `replace`, `remove`, `insert`, `move`. Targets are component names or child names, never element ids. Role overrides (`role-<name>.yaml`) apply first, user overrides (`user-<name>.yaml`) second.

## The gate

Every page, override and agent proposal goes through the same validator: the component exists with that version, the data source exists, the user's role may read it, the source's returned type is accepted by the component, params are allowed, props match the component schema, grid areas and children match. An invalid node renders as a fallback box with the reason; the rest of the page renders.

## Component props

Each entry in `components/registry.yaml` can declare a `props:` schema. Types: `string`, `number`, `boolean`, `text` (multiline string), `enum[a,b,c]`, `string[]`, `number[]`; a trailing `?` makes a prop optional. Undeclared props, missing required props, wrong types and values outside an enum are errors. Entries without `props:` accept anything; `data` and `names` are injected by the resolver and never checked. Containers set `container: true`.

```yaml
layout/card:
  description: Card with an optional title wrapping its children
  container: true
  props: { title: string?, tone: "enum[info,warn]?" }
  versions: { "1.0.0": { impl: ./Card.jsx } }
```

`buildCatalog(registry, z)` turns the registry into a json-render catalog (Zod props, `slots: ["default"]` on containers) for `defineCatalog(schema, ...)`.

## Next.js

Full example in [`examples/nextjs`](examples/nextjs). Add `transpilePackages: ["@aeratic/pagetailor"]` to `next.config.js` and run `npx pagetailor registry` to generate `pagetailor/components/index.js` (rerun it when `registry.yaml` changes).

```js
// app/api/page/[page]/route.js  (server only)
import { join } from "node:path";
import { resolve } from "@aeratic/pagetailor";
export async function GET(req, { params }) {
  const q = req.nextUrl.searchParams, { page } = await params;
  return Response.json({ page, ...(await resolve(join(process.cwd(), "pagetailor"), page, { user: q.get("user"), role: q.get("role") })) });
}

// app/PageClient.jsx  ("use client": import only from /client, never the package root)
import { Page } from "@aeratic/pagetailor/client";
import { registry } from "../pagetailor/components/index.js";
// fetch(`/api/page/home?user=giulia&role=marketing`) then <Page resolved={json} registry={registry} />
```

## Caching

`resolve` keeps resolved pages in memory per page/user/role and returns them without calling data sources again while the project files involved are unchanged. Pass `{ fresh: true }` to bypass it, or `{ maxAge: ms }` to expire entries (default 0, no time limit; `pagetailor dev` uses 2000). `clearResolveCache()` empties it.

## Proposals and approval

Changes go through `propose(root, { name, override, author, role })`, which first runs the gate: the override is applied to its page (`extends` is required) and validated for the role it targets. A failing gate returns `{ ok: false, errors }` and records nothing.

- A user's own override (`user-ann` proposed by `ann`) is applied immediately.
- Anything shared (a `role-*` override, or another user's override) is stored as `pending` and the override file is left untouched.
- Each page lists the roles allowed to approve it in `manifest.yaml`: `owners: { home: [admin] }`.
- `approve(root, { name, version, approver, approverRole })` re-runs the gate and commits a new applied version with `approvedFrom`; the proposal is marked `approved`. `reject(root, { name, version, approver, approverRole, reason })` marks it `rejected`. `listPending(root)` lists open proposals, newest first.

Roles named in a proposal (the target role of a `role-*` override, the `role` of a user proposal, the `approverRole` of an approval) must exist in `manifest.roles`.

Dev server routes: `POST /api/propose`, `GET /api/pending`, `POST /api/approve`, `POST /api/reject` (400 with `{ ok: false, errors }` when the gate or owner check fails). `POST /api/override` still commits directly.

## Reorder editor

In `pagetailor dev`, set a user, then click **Edit layout** in the header: the cells of every `layout/grid` get a dashed outline and become draggable. Drop one cell on another to swap their area names (all occurrences of both) in `areas`.

Each drop sends a `set-areas` patch through `POST /api/propose` as `user-<user>` (author = that user, `why: "reordered in the editor"`), merged into that user's existing override: an earlier `set-areas` on the same grid is replaced, other patches are kept. The user's own override applies at once and the page re-fetches; gate errors are shown in red.

In your own app wrap `<Page>` in `<EditorContext.Provider value={{ editing, propose }}>` with values from `useEditor({ page, user, role, why, onApplied })` (all from `@aeratic/pagetailor/client`); the base Grid uses `EditableGrid` and renders as usual outside editing. The resolver adds a hidden `__pt: { path, name, container }` prop to every element for this mapping. This first version only swaps whole cells; resizing and moving across grids are not supported yet.

## The agent

A user asks in natural language ("put the KPI at the top"); the agent turns it into override patches that go through the same gate as everything else. It never writes files itself.

1. `buildAgentPrompt(root, { page, user, role, request })` returns `{ system, user }`: the rules, the catalog visible to that role (`describeCatalog`: components with props and accepted type, readable data sources, the op vocabulary) and the current page for that user (`describePage`: the resolved tree with child names and grid areas).
2. The model answers with JSON only: `{ "why", "patches": [...] }`, or `{ "refuse" }` when the catalog or the role cannot satisfy the request. `parseAgentReply` tolerates code fences and surrounding prose.
3. `runAgent(root, { page, user, role, request, complete })` appends the patches to the user's existing override for that page (same merge rule as the editor) and calls `propose` as `user-<user>`: applied at once for the own user, pending otherwise.
4. If the gate rejects, the gate errors are sent back once ("The previous patch was rejected: ... Fix it.") and the result is proposed again. The result reports `attempts`.

`complete` is any `async ({ system, user }) => text`, so any model or SDK works; pagetailor depends on none. Built-in adapters over plain `fetch`: `anthropicComplete`, `openaiComplete` (OpenAI and every provider speaking its chat-completions format), `googleComplete` (Gemini). `createComplete({ provider, model, apiKey, baseUrl })` picks one by name: `anthropic`, `openai`, `google`, `groq`, `mistral`, `deepseek`, `xai`, `openrouter`, `ollama` (local, no key) or `compatible` (any URL). `completeFromEnv()` reads the same from the environment and is what `pagetailor dev` uses:

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` | the key of the provider to use; with one key set nothing else is needed |
| `PAGETAILOR_PROVIDER` | force a provider when several keys are set, or choose `ollama` / `compatible` |
| `PAGETAILOR_MODEL` | the model; defaults exist for anthropic, openai, google, mistral, deepseek, required for the others |
| `PAGETAILOR_LLM_URL` | base URL for `compatible`, or to override a provider's URL (a proxy, an Ollama on another host) |
| `PAGETAILOR_LLM_KEY` | the key for `compatible` |

In `pagetailor dev`, set one of the variables above and use the "Change this page…" box in the header: `POST /api/agent` with `{ page, user, role, request }` (503 when no provider is configured). `GET /api/agent/prompt?page=&user=&role=&request=` returns the built prompt for debugging.

## Pages as answers

A user asks a question ("how did sales go this week?") and the agent composes a brand-new page from the catalog instead of changing an existing one.

1. `runAsk(root, { user, role, request, complete })` starts from an empty `layout/stack`, asks the model for `{ "title", "why", "patches" }` using only `insert` ops (cards, grids, widgets), applies them in memory and resolves the tree with `resolve(root, "answer", { user, role, tree })`. Gate or resolve errors are sent back once, like `runAgent`.
2. The result (`{ title, why, tree, resolved }`) is rendered as is. Nothing is written to disk until the user decides.
3. Keep as page: `keepAnswer(root, { user, role, title, tree, why })` writes `pages/<slug>.yaml` with `owner: <user>` and adds the slug to `manifest.pages` (slugs are made unique with `-2`, `-3`).
4. Pin to home: `pinAnswer(root, { user, role, title, tree, why })` proposes, as `user-<user>`, an `insert` of a `layout/card` with the answer's widgets into the home's main container; on a grid it gets its own full-width row at the bottom. Same gate and proposal rules as any override.

Both go through the gate with the user's role first. In `pagetailor dev` use the "Ask…" box: `POST /api/ask` `{ user, role, request }` (503 when no provider is configured), `POST /api/ask/keep` and `POST /api/ask/pin` with `{ user, role, title, tree, why }`.

## Studio

`pagetailor dev` has two views in the top bar: **Preview** (the app as rendered, with the editor and agent boxes) and **Studio**, a visual editor for the whole `pagetailor/` project (`http://localhost:4747/?view=studio`). The first tab, **App**, edits `manifest.yaml`: name, home, navigation position, pages (adding one creates `pages/<slug>.yaml` with an empty `layout/stack`; the home page cannot be removed), roles (a role still used as a page owner or by a data source cannot be removed) and page owners.

The **Pages** tab edits `pages/<slug>.yaml`: a tree of the page's components (with the child name under a grid and the bound data source) and an inspector for the selected node. The component select lists every `name@version` in the registry (switching keeps the props the new schema still declares), props are form fields generated from the registry schema (free JSON when a component has none), the data select offers only the catalog sources whose type the component accepts, with their params. Containers can add, remove and reorder children; a grid renames and removes named children together with their cells in `areas`, and a new child gets a full-width row. The tree is validated live with the same `validateTree` as the server, so problems show before Save.

The files stay the source of truth: each tab loads its file into a draft, the YAML pane at the bottom shows the draft as it will be written, and **Save** writes the file through the same validator as `pagetailor validate` (errors are shown in red and nothing is written; saving a page also re-applies every override that extends it, so renaming a child that an override targets is refused with the override's name). Saves rewrite the file keeping its top-level comments. Every save is versioned under `.history/files/<name>/NNNN.json` with the content before and after and a `why` (versions are allocated exclusively, so concurrent writers never collide); **Undo** restores the previous content as a new version. The **auto-save** checkbox saves 1.5 s after the last change.

Routes: `GET /api/project`, `GET|PUT|DELETE /api/files/<name>`, `GET /api/files/<name>/history`, `POST /api/files/<name>/undo`, where `<name>` is `manifest`, `tokens`, `data-catalog`, `components/registry`, `pages/<slug>` or `overrides/<name>`. The same functions are exported: `readProjectFile`, `writeProjectFile`, `deleteProjectFile`, `listFileHistory`, `undoFile`, `scaffoldSource`, `scaffoldComponent`.

## Status

0.4: engine, CLI (`init`, `validate`, `registry`, `dev`), history with rollback, proposals with owner approval, reorder editor, agent with a pluggable model adapter, pages as answers.

License: MIT.
