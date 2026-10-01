# esdev migration status

Output hooks and generated SPA/docs templates verified against esdev 0.15.0 on
2026-10-02. OTF template integration is intentionally pending upstream, after
validation here. The DOM and asset observations below were recorded against
0.14.0 and await re-verification.
Template files are embedded in the esdev binary; updating this repo's plugin cannot change them.

## Working in this repository

- Site and playground development/builds use declarative esdev configs.
- The compiler plugin transforms JSX/TSX/MDX and returns source maps; esdev owns
  final bundling, CSS and map composition. Markdown maps currently target generated JSX.
- Rust, framework DOM tests and browser tests run through `tsr` and esdev.
- `@opentf/web-test/setup` registers native `runtime:test` cleanup. JSX compilation
  belongs to the esdev plugin, and the runner supplies the DOM.
- Native `web-test` coverage verifies rendering, props, role queries and teardown;
  real-browser coverage verifies the full Testing Library user-event workflow.
- The standalone plugin integration test builds browser/server targets from package
  files and verifies real HTTP API, middleware, loader and SSR requests.
- Shared benchmark orchestration, aggregation and fixture generation use esdev.
  Comparison-framework build scripts retain their existing Bun toolchains.
- Release site builds prerender pages and generate OTF Search, feeds and LLM files.
  CI runs a release site build as well as unit and browser suites.

## Upstream starter fixes required

Reproduce with `esdev create <dir> --template=<name> --package-manager=pnpm
--no-install --yes`.

| Template | Observed output | Required change |
| --- | --- | --- |
| `spa` (0.15) | No esdev.json; otfw dev/build/build --ssg scripts; HTML lacks a module entry | Emit native config, OTF plugin dependency and a client entry that imports @otfw/routes and calls mountApp; use esdev scripts; make the stylesheet URL relative |
| `docs` (0.15) | No esdev.json; otfw dev/build --ssg scripts | Emit client/config plus a release prerender target; use provider otf and index the prerendered output; make the stylesheet URL relative |
| `fullstack` (0.14) | No esdev.json; otfw dev/build/serve scripts | Emit client and server targets, a Request/Response server entry, API/middleware/loader wiring, and native run/watch scripts |
| `library` (0.14) | esdev test script, but no compiler/test config; test only checks source files | Configure CSR compilation with routes disabled and native DOM cleanup; test an imported, rendered component |

SPA/docs/fullstack currently request the retired @opentf/web-cli executable.
They need an upstream template change and a new esdev binary release, followed
by fresh-project build/start/preview/test checks against published packages.
The repo's standalone plugin test verifies package integration independently;
it does not claim those generated templates already work.

## Upstream DOM compatibility

In the native DOM of esdev 0.14:

- `userEvent.setup()` fails when it tries to define navigator.clipboard on the
  non-extensible navigator.
- `userEvent.type(input, text)` encounters a missing HTMLInputElement.select API.

Use native DOM actions for the fast tier and `esdev test --browser` for full
Testing Library interactions. Fix the native DOM APIs upstream before documenting
userEvent.setup as supported by --dom. Do not replace the runner's globals with
happy-dom or a local DOM implementation.

## Output hooks and development SSG

The configured `siteOutputPlugin` from `@opentf/web-cli/ssg` uses esdev 0.15's
release-only `finish` hook. After all targets and `then: run` steps succeed, it
indexes prerendered HTML and generates feeds/LLM files into the hook's staged
`outDir`. An indexing error prevents publication and preserves the last deployment.

`website/ssg.js` still prerenders routes and generates sitemap/robots from the
actual rendered paths. It calls `writePrerenderReport` to pass resolved site
metadata to the hook; the hook removes this temporary report before publication.
The website owns `website/esdev.json`; repository site tasks run from that
directory. It installs locked, published packages independently of the workspace
and registers both the compiler/routes plugin and the output plugin locally.
The prerender entry loads installed SSG helpers at runtime so package-relative
compiler archive paths are preserved when esdev bundles the entry.

Development runs neither `finish` nor the prerender step by default. Browser-only
selected builds skip output generation when their configured `prerenderTarget`
was not built; they preserve the existing index rather than indexing a CSR shell.
The integration fixture covers staging, searchable section links, public overrides,
indexer failure, selected builds and an isolated development server.

## HTML entry hash references

Reproduced against esdev 0.15.0 with a converted, installed SPA starter. Its
native build emits `dist/assets/entry-<hash>.js`, while the route's generated
`page-<hash>.js` still imports `./entry.js`. The missing module prevents the
page from mounting in preview. The converted docs starter has the same imports
in its layout and shared docs chunks. Development serves correctly; a successful
release build alone does not establish browser readiness.

The native OTF benchmark build in esdev 0.14 also emits
`benchmarks/otfw/dist/assets/entry-<hash>.js`, while its generated `page-<hash>.js`
imports `./entry.js`. That un-hashed file does not exist, so the browser cannot
load the route. Reproduce with `tsr bench -- otfw --throttle=1`, or build with
`tsr bench-otfw-build` and inspect the route chunk's first import.

Fix references to renamed entry chunks in esdev's HTML build pipeline. The native
runner itself is verified with a controlled browser fixture; a real OTF benchmark
measurement is blocked by the generated asset reference. Do not publish timings
from the failed run or relabel historical benchmark reports.

## JavaScript asset URLs

A native browser fixture verified that module workers created with
`new Worker(new URL("./worker.js", import.meta.url), { type: "module" })` are
bundled and rewritten correctly. However, an ordinary
`new URL("./icon.svg", import.meta.url)` is preserved without emitting the icon.
It resolves next to the output bundle and can point at a missing file.

Use configured public assets for ordinary image/WebAssembly URLs until esdev's
asset pipeline supports these references. The old framework CLI's rewriting
helper is not installed by the native compiler plugin.

## Release handoff

The maintainer owns release.toml changes, package versions and publishing.
Release the updated compiler archives and the packages that consume them:
@opentf/web-compiler, @opentf/esdev-plugin-web, @opentf/web-cli,
@opentf/web-docs and @opentf/web-test.

The compiler package ships one otfwc executable per supported platform, including
the `docs index`, `docs inspect` and `docs query` commands. See [search/RELEASE.md](../packages/web-docs/search/RELEASE.md).
The finish plugin additionally requires a new @opentf/web-cli release and esdev
0.15 or newer. The unified indexing command requires rebuilding and publishing the compiler archives.
The new web-test setup removes the Bun preload and happy-dom dependency; migrate
consumers to esdev.test.json and runtime:test imports as documented in its README.

The deprecated create-web package remains compatibility source until removal;
it is not the location for new starter development.

## Validation before updating upstream templates

Fresh SPA and docs projects were generated outside this workspace with esdev
0.15.0 and installed from npm. Their temporary configs were converted to native
esdev targets and the published `@opentf/esdev-plugin-web` 0.2.0.

- SPA: native build and a `@opentf/web-test` reactive component test pass. Chromium
  verifies that the development route mounts and its counter responds to clicks.
- Docs: with the local compiler/CLI resolver fixes overlaid into the temporary
  installation, an ordinary bundled SSG import prerenders four pages, indexes two,
  and emits blog feeds and LLM context. No binary override, workspace sources,
  dynamic SSG import or site-specific canonicalization is needed.
- The committed regressions cover bundled compiler extraction with both direct
  and transitive dependencies, plus shared runtime state through symlinked package
  resolution and aliases.
- Release preview is blocked by the upstream HTML chunk-reference issue above.
  Recheck SPA mounting and docs hydration/search after that esdev fix.

Release the resolver fixes in `@opentf/web-compiler` and `@opentf/web-cli` before
upstream templates consume them. The plugin's minimum esdev version is now 0.15;
release that manifest update with its compiler dependency update. The native
compiler's Rust code and indexing format did not change.
