# @opentf/web-cli

The SSG library used by OTF Web projects during `esdev build`. The package retains
its historical name, but the `otfw` executable and its dev/build/serve commands
have been retired.

## Installation

For projects with a prerender script:

```bash
pnpm add -D @opentf/web-cli @opentf/esdev-plugin-web
```

Apps also depend on `@opentf/web`. Install esdev 0.14 or newer and configure the
OTF compiler/routes plugin in `esdev.json`.

## Development and builds

```bash
esdev start
esdev build --minify
esdev preview
```

The project owns its HTML entry and build targets. For static rendering, add a
second target with a prerender entry and `"then": "run"`, following this repo's
[`esdev.json`](../../esdev.json) and [`website/ssg.js`](../../website/ssg.js).
The script checks for release staging, prerenders pages, and runs optional search,
feed and LLM-file generation before esdev publishes the staged output.

## SSG exports

Import helpers from `@opentf/web-cli/ssg`. This stable entry exposes route/loader
collection, compiler resolution, `runPrerender`, API/loader bundle emission,
docs build helpers and build reporting. It does not supply a dev server or an
SSR request server. A fullstack app must provide its own server entry and adapter.

`OTFWC_BIN` overrides the compiler binary. `OTF_SEARCH_BIN` overrides the search
indexer. Published installations use the binaries shipped by `@opentf/web-compiler`;
this repository can use its Cargo debug builds.

## Starter migration

Templates are embedded in esdev. The installed esdev 0.14 OTF app templates still
emit retired `otfw` scripts; see the [migration status](../../docs/ESDEV_MIGRATION.md)
for the upstream changes required before new generated projects can run.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation).
