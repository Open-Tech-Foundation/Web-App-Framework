# Shipping OTF Search

Search remains owned by `@opentf/web-docs`; there is no new npm search package.
Compilation and documentation indexing share the `otfwc` executable shipped by
`@opentf/web-compiler`.

## Release CI artifacts

For each target in root `release.toml`, build the unified toolchain:

```sh
cargo build --release -p otfw_cli --bin otfwc --target <triple>
```

`otf-release` stages and Brotli-compresses the one executable per target:

| Target | Package archive |
| --- | --- |
| `x86_64-unknown-linux-gnu` | `bin/linux-x64/otfwc.br` |
| `aarch64-apple-darwin` | `bin/darwin-arm64/otfwc.br` |
| `x86_64-apple-darwin` | `bin/darwin-x64/otfwc.br` |
| `x86_64-pc-windows-msvc` | `bin/win32-x64/otfwc.exe.br` |

`otfwcPath()` lazily extracts the archive, sets executable permissions on Unix,
and supports `OTFWC_BIN` for source builds. Both JSX compilation and indexing use
this path. The former separate search executable, resolver and staging script
have been removed. There is no second binary to build or upload.

The indexing commands are:

```sh
otfwc docs index <site-dir> [--out <index-dir>] [--root <selector>]
otfwc docs inspect <index-dir> --term <term>
otfwc docs query <index-dir> <query>
```

Release the updated `@opentf/web-compiler` before/with `@opentf/web-docs` and
`@opentf/web-cli`. The docs build helper requires the binary containing `docs index`;
an older compiler that only prints its help is rejected rather than accepted as
a successful indexing run. Versions and publishing are managed by the maintainer.

Ship the updated native indexer together with the docs reader for prose previews:
new fragments include `excerptOmit` ranges for code blocks. Rebuild site indexes
with that binary; old indexes remain readable but lack code omission metadata.

The package allowlist includes `search.js`; Pagefind is no longer a dependency.
`@opentf/web-docs/search` exposes the DOM-free reader. Built sites need only static
`_search` assets, not the native executable or a search server.

## Output-hook integration

The configured `siteOutputPlugin` from `@opentf/web-cli/ssg` uses esdev 0.15's
release-only `finish` hook. It calls `indexWithOtfSearch({ siteDir, otfwc })` after
the prerender target finishes, using the staged browser output directory.
Indexing failures prevent publication and preserve the previous deployment.

Development runs neither the hook nor the prerender step by default. Use a release
preview to test search. A selected browser-only build skips indexing when the
configured prerender target was not built.

## Deployment caching

Revalidate `_search/manifest.json`. Hash-named term chunks, document tables and
fragment generation directories are immutable. Retaining previous immutable
assets permits an already-open client to finish searching its original generation.
If an old payload is gone, the reader reports failure and reloads the manifest on
the next query. It never reads a new generation's fragments with old document IDs.
