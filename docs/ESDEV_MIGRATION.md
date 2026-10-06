# esdev migration status

Verified on 2026-10-06 against **esdev 0.16.0** (`esdev upgrade --dry-run`: up to
date) and Chromium 153. The migration inside this repository is complete; the
remaining items are upstream esdev issues and framework follow-ups listed below.

## Working in this repository

- Development, builds, tests, typechecking, benchmarks and the site build run
  through `tsr` tasks that call esdev (`tasks.toml`). Bun, happy-dom and the
  retired `otfw` CLI are no longer used by the framework packages.
- `@opentf/esdev-plugin-web` compiles JSX/TSX/MDX through `otfwc` and generates
  the `@otfw/routes` module; esdev owns bundling, CSS, HMR transport and serving.
- `@opentf/web-cli` is only the SSG library (`@opentf/web-cli/ssg`): the
  prerender driver for a `then: "run"` target and the release-only
  `siteOutputPlugin` that writes search, feeds and LLM files.
- The comparison benchmarks (`benchmarks/{react,solid,svelte}`) keep their own
  Bun build scripts; OTF orchestration and aggregation run on esdev.

Checks run for this verification:

| Check | Result |
| --- | --- |
| `tsr typecheck` | Pass |
| `tsr test` (Rust + native/DOM suites) | Pass |
| `tsr test-e2e` (docs drawer/sidebar/hydration, browser userEvent, bench runner, HMR) | Pass |
| `tsr build` (playground) | Pass |
| `tsr site-build` | Pass: 65 pages prerendered, 63 indexed, feeds and LLM files |
| `tsr bench -- otfw` | Completes: route chunks import the hashed entry |

## Generated OTF starters

esdev 0.16 embeds native `spa`, `fullstack`, `docs` and `library` templates. Each
was created with `--language=js` and `--language=ts`, installed from npm with pnpm
(`@opentf/web` 0.30.0, plugin 0.3.0, web-test 1.25.0, web-docs 0.28.0, CLI
1.28.0) and driven in headless Chromium.

| Template | Published packages | With this checkout's packages |
| --- | --- | --- |
| `spa` | Test, build, dev and preview pass; counter mounts and updates. TS typecheck fails: `@opentf/web-test` had no declarations. | TS typecheck passes. |
| `fullstack` | Test, build, typecheck pass. Dev and production (`esrun dist/server.js`) serve SSR + hydration, loader data, API, middleware header and the 404 page. Needs the generated `bootstrap.js`. | Passes in dev and production with `bootstrap.js` deleted and the server target pointing at `server.js`. |
| `docs` | Build prerenders four pages, indexes two, writes feeds and LLM files. Docs, sidebar, blog index and post render in dev and preview. TS typecheck fails: `@opentf/web-docs` had no declarations. | TS typecheck passes. |
| `library` | Rendering tests pass. TS typecheck fails: `@opentf/web-test` had no declarations. | TS typecheck passes. |

The checkout-package column needs the next releases of `@opentf/web`,
`@opentf/esdev-plugin-web`, `@opentf/web-compiler` (rebuilt `otfwc`),
`@opentf/web-docs` and `@opentf/web-test`.

## Upstream esdev issues

### 1. Dev server panics after recovering from a transform error

With the OTF plugin, saving a page with a syntax error shows the expected build
overlay. Saving the fixed file then kills `esdev start`:

```text
rolldown-1.2.3/src/types/scan_stage_cache.rs:79:28
called `Option::unwrap()` on a `None` value
```

Reproduce: `esdev create app --template=spa`, install, `esdev start`, change
`<h1>Hello, world!</h1>` in `app/page.jsx` to `<h1>Broken</h1 <<`, save, then
restore it. Reproduced on 0.15.0 and 0.16.0. On 0.15 a plain JavaScript syntax
error without the plugin recovered, which points at plugin transform errors in
Rolldown's incremental scan cache; that comparison was not repeated on 0.16.

### 2. Native `--dom` realm is missing APIs Testing Library uses

- `userEvent.setup()` throws `TypeError: Cannot define property clipboard, object
  is not extensible`: `navigator` cannot take the clipboard stub.
- `userEvent.type(input, ...)` updates the value but reports
  `Element INPUT does not implement "select"`: `HTMLInputElement.select()` is
  missing.

Both fail on 0.14 and 0.16. `esdev test --browser` runs the same workflows
correctly; docs point users there until the realm supports them.

### 3. `new URL("./file", import.meta.url)` assets are not emitted

`new Worker(new URL("./worker.js", import.meta.url))` is bundled and rewritten,
but an ordinary asset reference such as `new URL("./icon.svg", import.meta.url)`
stays verbatim in the output and the file is never copied, so it 404s in preview
(`/assets/icon.svg`). Reproduced on 0.16 from plain JavaScript (not compiled by
the OTF plugin), so this is the asset pipeline itself. Users must put such files
in `public/` for now.

### 4. `esdev preview` ignores `dist/404.html`

Preview answers every unknown route-like path with `index.html` and status 200,
including SSG output that ships a prerendered `404.html`. For a docs site this
serves the prerendered home page at `/missing-page/`. Static hosts configured
for SSG (e.g. Cloudflare `not_found_handling: "404-page"`) return `404.html`
with status 404. Preview should do the same when the output has a `404.html`,
and keep the SPA fallback otherwise.

### 5. Fullstack template bootstrap

The template's server target enters through `bootstrap.js`, which stubs
`globalThis.HTMLElement` before importing `server.js`. Once the next
`@opentf/web`, plugin and compiler releases are published (server builds then
resolve framework imports through the DOM-free server entry), the template
should drop `bootstrap.js`, point the server target at `server.js`, and pin the
new package versions.

## Framework follow-ups

- Hydration adopts prerendered markup without checking that it was rendered for
  the current URL, so a host falling back to `index.html` shows that page's
  content for an unknown path instead of the 404 route.
- Original Markdown/MDX source maps (current maps target generated JSX).
- MDX 404 routes are rejected; use `404.jsx`/`404.tsx`.
- SSG omits spread attributes and multi-node roots (warned during builds).
- Benchmarks: the published tables predate the migration. Re-run all four engines
  under the same conditions before replacing them.

## Component refresh

See [HMR verification](HMR_VERIFICATION.md) for the browser check, compatibility
limits and the error-recovery issue above.
