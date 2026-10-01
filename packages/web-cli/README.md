# @opentf/web-cli

The SSG library used by OTF Web projects during `esdev build`. The package retains
its historical name, but the `otfw` executable and its dev/build/serve commands
have been retired.

## Installation

For projects with a prerender script:

```bash
pnpm add -D @opentf/web-cli @opentf/esdev-plugin-web
```

Apps also depend on `@opentf/web`. Install esdev 0.15 or newer and configure the
OTF compiler/routes plugin in `esdev.json`.

## Development and builds

```bash
esdev start
esdev build --minify
esdev preview
```

The project owns its HTML entry and build targets. For static rendering, add a
second target with a prerender entry and `"then": "run"`, following this repo's
[`website/esdev.json`](../../website/esdev.json) and [`website/ssg.js`](../../website/ssg.js).
The script checks for release staging and prerenders pages, including sitemap and
robots output. A release-only `siteOutputPlugin` then generates search, feeds and
LLM files in staging before publication:

```json
{ "module": "@opentf/web-cli/ssg", "export": "siteOutputPlugin",
  "options": { "target": "web", "prerenderTarget": "site-ssg", "root": "." } }
```

Add that object to the project-level `plugins`. `root` locates the source site
relative to the project working directory; `target` selects the browser output.
The prerender step calls `writePrerenderReport(outDir, result)` with the return
value of `runPrerender`, preserving resolved site descriptions for LLM context.
The hook consumes and removes the temporary report before publication.

The hook never runs during `esdev start`. When `prerenderTarget` is configured,
a selected build omitting it skips generation rather than indexing a CSR shell.
Building both targets without the report fails with a configuration error.
Indexing failures fail the build and leave the previous deployment intact.

## SSG exports

Import helpers from `@opentf/web-cli/ssg`. This stable entry exposes route/loader
collection, compiler resolution, `runPrerender`, API/loader bundle emission,
docs build helpers and build reporting. It does not supply a dev server or an
SSR request server. A fullstack app must provide its own server entry and adapter.

`OTFWC_BIN` overrides the unified toolchain binary. Compilation and documentation
indexing (`otfwc docs index`) use that same executable. Published installations
use the archive shipped by `@opentf/web-compiler`; this repository can use its
Cargo debug build.

## Starter migration

Templates are embedded in esdev. The installed esdev 0.14 OTF app templates still
emit retired `otfw` scripts; see the [migration status](../../docs/ESDEV_MIGRATION.md)
for the upstream changes required before new generated projects can run.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation).
