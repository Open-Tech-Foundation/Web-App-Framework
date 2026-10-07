# Framework Roadmap

## Phase 1: MVP (Complete)
* [x] Basic JSX to DOM transformation.
* [x] Web Component wrapping.
* [x] Signal-based reactivity.
* [x] File-based routing.
* [x] Compiler-driven lifecycle hooks (onMount/onCleanup).

## Phase 2: Refinement (In Progress)
* [x] Formalized naming conventions (standard .jsx).
* [x] Compiler enforcement.
* [x] Children/Slot support (Light DOM).
* [x] Tailwind CSS v4 integration.
* [ ] Fragment support (<>...</>).

## Phase 3: Advanced Features
* [ ] Conditional rendering helper.
* [ ] List rendering helper (keyed reconcile).
* [ ] Shadow DOM support for style isolation.
* [ ] Server-Side Rendering (SSR) / Static Site Generation (SSG).

## API Routes — see [docs/API.md](API.md)
* [x] Phase A: file-based `app/api/**` `Request→Response` handlers, method exports, `[param]`/`[...rest]`, nested `_middleware`, runtime handlers and API-bundle emission (`dist/server/api.js`); native esdev fullstack orchestration remains to be verified, Node/Fetch adapters.
* [ ] Phase B (compiler): typed server functions / loaders + actions via the Server IR, splitting the client/server boundary.

## Data Fetching — see [docs/DATA.md](DATA.md)
* [x] Phase A.5 (runtime/toolchain): route loaders (`loader.{js,ts}` → `router.data`; inline payload + `<path>/__data.json` across dev/serve/SSG/SPA-nav) and the client-side `resource()` primitive.
* [ ] Phase B (compiler): co-located `export loader` stripped by the compiler, queries/actions — same wire format and runtime API.

## Internationalization (i18n) — see [docs/I18N.md](I18N.md)
* [x] Phase 1 (runtime): locale path-prefix routing, ICU messages (`t()`), `Intl` formatters, per-locale SSG/SSR. `@opentf/web-i18n`.
* [ ] Phase 2 (compiler): `otfwc` message extraction, key validation, tree-shaking, per-locale inlining.

## Diagnostics & source maps
* [x] Located compile diagnostics: every compiler failure (syntax, `$state` mutation, callback `ref`, no-component) carries `file:line:column` and a code frame, rendered in the terminal and pushed to the dev overlay as structured fields.
* [x] JSX/TSX source maps from `otfwc`: original statements, expressions and callbacks carry mappings; the esdev plugin returns them for bundler composition. Compiler-generated helpers remain unmapped.
* [ ] Original Markdown/MDX source maps: current maps target the generated `?otfw-jsx` intermediate. The Markdown front end still needs to supply the preceding mapping.
* [x] Native esdev starters (spa, fullstack, docs, library) verified on esdev 0.16. Open upstream issues: [ESDEV_MIGRATION.md](ESDEV_MIGRATION.md).

## Known issues
Open items carried over from the 2026-10 site and HMR audits.
* [ ] SSG omits spread attributes and multi-node (fragment) roots; the client restores them after hydration.
* [x] `@opentf/web-docs` `Tabs`: add tab/tabpanel roles, selection state and arrow-key navigation.
* [x] `@opentf/web-docs` `BlogLayout`: show "Last updated" only when the update is later than publication, not merely different.
* [x] Portal guide's custom overlay demo lacks modal semantics, focus containment, Escape handling and focus restoration.
* [x] Homepage render-pipeline tour pauses while hovered.
* [x] Component refresh: page/layout edits keep route-tree state and leave unaffected layers and children in place.
* [ ] Component refresh: mixed-export and `$expose` modules still reload. Re-check with `tsr test-e2e-hmr`.
