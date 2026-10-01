# Shipping OTF Search

Search remains owned by `@opentf/web-docs`; there is no new npm search package.
The Rust executable is a second binary in `otfw_cli`, shipped by `@opentf/web-compiler`.

## Release CI artifacts

For each target already listed in the root `release.toml`, build both binaries:

```sh
cargo build --release -p otfw_cli --bins --target <triple>
```

`otf-release` stages `otfwc`. The temporary
`scripts/stage-search-binary.mjs` step then compresses and stages `otf-search`
inside the same `.artifacts/@opentf/web-compiler/bin/<stage_as>/` tree before
upload. It requires the compiler archive and search executable to exist; a
missing binary fails that matrix leg. The publish job merges all platform trees
into the compiler package.

The search archives are:

| Target | Source executable | Package archive |
| --- | --- | --- |
| `x86_64-unknown-linux-gnu` | `target/<triple>/release/otf-search` | `bin/linux-x64/otf-search.br` |
| `aarch64-apple-darwin` | `target/<triple>/release/otf-search` | `bin/darwin-arm64/otf-search.br` |
| `x86_64-apple-darwin` | `target/<triple>/release/otf-search` | `bin/darwin-x64/otf-search.br` |
| `x86_64-pc-windows-msvc` | `target/<triple>/release/otf-search.exe` | `bin/win32-x64/otf-search.exe.br` |

Keep the existing `otfwc[.exe].br` artifacts too. Workflow regeneration currently
overwrites the manual staging step: restore it until the release tool supports
multiple binaries in one package. Keep pnpm setup reading `packageManager` from
package.json rather than requesting a conflicting `latest` version. Use the same Brotli compression
as the compiler. `otfSearchPath()` lazily extracts the search archive, sets the
executable permission on Unix, and supports `OTF_SEARCH_BIN` for source builds.
A missing executable fails enabled search builds with an actionable error.

Release the updated `@opentf/web-compiler` before/with `@opentf/web-docs`, whose
runtime dependency must resolve to the version exporting `otfSearchPath` and
containing the binary. Also release `@opentf/web-cli`: its shared SSG helper now
propagates indexing failures instead of producing a successful build without search.
Versions and the release matrix are managed by the maintainer and release CI.

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
