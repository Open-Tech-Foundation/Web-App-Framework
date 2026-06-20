---
name: csr-dev-server
description: "How to run CSR playground apps on the new pipeline, and its current gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb86332b-2e70-4dfd-90f7-fb2545f96137
---

`bun run dev` starts our own CSR dev server (now a real package
`@opentf/web-cli`, at `packages/web-cli/src/dev.js`, bin `otfw-dev`;
ARCHITECTURE §8) — **no Vite**. It drives Rolldown as a library: a Rolldown
`transform` plugin runs the Rust compiler per `.jsx/.tsx` via
`otfw build [--component] --stdin <id>`, plus a CSS plugin (`*.css` → injected
`<style>`; `*.module.css` → identity class map). Rolldown bundles/code-splits
(alias `@opentf/web` → `packages/web/index.js`), and `Bun.serve` serves it.

- **No route arg** anymore: it discovers every `app/**/page.jsx` (+ optional
  `404`) and generates an entry that calls `mountApp({ pages })` where each route
  is a lazy `() => import()` (code-split). `EXCLUDE_ROUTES` (default
  `repl,forms-demo`) skips routes still on not-yet-ported legacy APIs.
- **index.html**: serves the project's `index.html` (`WEB_ROOT`, default
  `playground`), stripping Vite-style module entry scripts and injecting our
  bundle + HMR client; also serves static assets. Falls back to a minimal shell.
- **HMR over WebSocket** at `/__hmr` (replaced SSE); rebuild → full reload, client
  auto-reconnects. Compile errors become per-route stub modules (diagnostic shown
  when that route renders) instead of failing the whole build.
- **Lifecycle**: `onMount`/`onCleanup` are compiler-collected (like `$effect`):
  components run them in connected/disconnected; page factories attach a
  `__lifecycle` record that `mount`/router drive.
- **Routing/runtime** (`packages/web/runtime/router.js`): `mountApp`, `navigate`,
  reactive `router` facade (pathname/params/query), `[param]`/`[...slug]` matching,
  history+popstate, `<Link>` → `web-link` Custom Element. Page-vs-component is by
  basename. Component tag/class come from the **function name**; component modules
  default-export their class so a page's `import Counter from "./Counter"` resolves.
- Compiler now **merges** a source's `@opentf/web` named imports into the single
  generated runtime import (dedup; drops macro imports) — fixes duplicate-decl.

Known gaps (follow-ups, not bugs):
- Layout composition + page `props.params`/`props.children` need signal-free page
  props (compiler doesn't emit them yet); pages read params via `router.params`.
- One component per module: extra named component exports aren't emitted/registered
  (breaks multi-component files like forms-demo, and `<TargetSelector/>` on home).
- `className=` emits a bogus literal attribute (use `class=`); no Tailwind build.
- HMR is full-reload only (no module-level hot replacement yet).
- Test preload `packages/web-test/setup.js` imports removed `@opentf/web/compiler`,
  so JSX-based bun tests error (pre-existing; runtime/core/router tests pass).

Related: [[new-runtime-decisions]].
