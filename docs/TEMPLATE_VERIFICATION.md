# Local OTF plugin template verification

Checked sequentially on 2026-10-02: SPA, fullstack, docs, then library.
The earlier registry-package check did not answer the requested local-plugin
verification. The results below replace it as the current verification result.

## What was tested

- esdev 0.15.0 and Chromium 153.0.8010.52.
- Fresh generated JavaScript projects, then temporary native configuration based
  on those projects. The native configs are necessary because the installed esdev
  templates still generate retired `otfw` commands.
- **Plugin code from this checkout**, copied into isolated project installations.
  The plugin file hash was checked against the checkout in all five fixtures,
  including the library consumer. No workspace symlinks or package aliases.
- Local OTF runtime, compiler wrappers, SSG helpers, docs and test package files
  where required by each fixture. Third-party dependencies remained installed.
- The existing local `target/debug/otfwc` executable was placed in each compiler
  package's platform directory. No published compiler binary or `OTFWC_BIN`
  override was used in these local checks. No release build/publishing was done.

Fixtures and logs: `/tmp/otfw-local-template-audit`. Each project's
`local-packages.json` records which checkout packages were copied and their paths.
The original generated projects remain under `/tmp/otfw-template-audit-y829yq`.

## Results with the local plugin

| Template | Checks that pass | Still blocked |
| --- | --- | --- |
| SPA | Native build, component click test, browser development rendering/counter update, added About route. | Production home route requests missing `/assets/entry.js`. The About route works. |
| Fullstack | Native build; API, middleware, loader JSON, SSR HTML and 404 HTTP checks with bootstrap; development displays loader-backed content. | Without bootstrap the public runtime import throws `HTMLElement is not defined`. Production browser requests missing `/assets/entry.js` and replaces SSR content with an error. |
| Docs | Ordinary bundled SSG import; four prerendered pages; two indexed pages; native index query; RSS/Atom and LLM files; development docs rendering and search mounting. | Production browser requests missing `/assets/entry.js`; preview search interaction cannot be verified yet. |
| Library | Two actual component tests: initial props/click update and defaults/test cleanup. Source package consumption builds. | Browser development consumer passes; production consumer is subject to the same missing entry reference. |

These passes verify the local plugin's compilation and integration for the tested
fixtures. They do not establish that the untouched generated templates work.

## Pending work

### 1. Fix esdev production chunk references

Browser builds emit `assets/entry-<hash>.js`, while some chunks still import
`./entry.js`. Chromium reproduces the resulting module 404 with the local plugin
in SPA, fullstack, docs and the library consumer. Development does not hash the
entry and works.

The bundler owns final chunk names and references. Fix this in upstream esdev,
then repeat production route mounting, hydration and docs search/navigation checks.

### 2. Handle DOM-free fullstack initialization

The public runtime entry includes classes extending `HTMLElement`, even when the
server uses only the router and string-rendering helpers. Its import fails in a
DOM-free server. The test used the minimal bootstrap already used by the SSG helper:

```js server-bootstrap.js
globalThis.HTMLElement ??= class {};
await import("./server.js");
```

With that bootstrap, the explicit API/middleware/loader/SSR pipeline passes the
HTTP checks. Make the server import path safe or include the required bootstrap
in fullstack setup. The fixture serializes rendering because runtime route/render
state is shared; production server design must account for concurrent requests.

### 3. Update the upstream generated templates

The local plugin does not replace files embedded in the installed esdev binary.
The generated SPA/fullstack/docs commands still fail with `otfw: not found`.
Library's generated test passes but only checks source existence/export text.

Generate the native setup validated here:

- SPA: compiler dependency/config, explicit browser entry, native scripts.
- Fullstack: browser/server targets, loader registration, request pipeline,
  bootstrap handling and app-owned development server.
- Docs: browser entry, docs/blog/date plugins, prerender script with staging guard,
  output hook and search configuration. Users must set their deployed `site.url`.
- Library: compiler-only CSR test config, cleanup setup and real component tests.
- Update template READMEs and use relative stylesheet URLs.

### 4. Publish only when handing these changes to external starters

Local docs builds already use the checkout's compiler extraction and canonical
resolver fixes. They are not blockers for this local test. External fresh installs
will need those package changes released before upstream templates consume them.
The maintainer owns release configuration and publishing.

## Verification commands and evidence

For SPA/library, tests used:

```bash
esdev test --config=esdev.test.json --dom
```

Builds used `esdev build --minify`. Browser checks used `esdev start`, static
`esdev preview` for SPA/docs, and the built request server for fullstack.
The library consumer imports the previously packed source library and was rebuilt
with the local plugin/runtime/compiler.

Logs under `/tmp/otfw-local-template-audit`:

- `spa-build.log`, `spa-test.log`, `spa-browser.log`.
- `fullstack-no-bootstrap-http.log`, `fullstack-build.log`, `fullstack-http.log`,
  `fullstack-browser.log`.
- `docs-build.log`, `docs-query.log`, `docs-browser.log`.
- `library-test.log`, `library-consumer-build.log`, `library-consumer-browser.log`.

Favicon 404s are incidental starter assets, separate from the module failures.
JavaScript/default template shapes were tested; TypeScript, optional styling,
no-blog and other package managers remain outside this check. Temporary fixtures
may be removed by system cleanup; this report preserves the findings.
