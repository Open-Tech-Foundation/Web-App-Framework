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
* [x] Phase A: file-based `app/api/**` `Request→Response` handlers, method exports, `[param]`/`[...rest]`, nested `_middleware`, `otfw dev`/`serve`/`build` (`dist/server/api.js`), Node/Fetch adapters.
* [ ] Phase B (compiler): typed server functions / loaders + actions via the Server IR, splitting the client/server boundary.

## Internationalization (i18n) — see [docs/I18N.md](I18N.md)
* [x] Phase 1 (runtime): locale path-prefix routing, ICU messages (`t()`), `Intl` formatters, per-locale SSG/SSR. `@opentf/web-i18n`.
* [ ] Phase 2 (compiler): `otfwc` message extraction, key validation, tree-shaking, per-locale inlining.
