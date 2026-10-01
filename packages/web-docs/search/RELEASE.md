# Shipping OTF Search

Search remains owned by `@opentf/web-docs`; there is no new npm search package.
The Rust executable is a second binary in `otfw_cli`, shipped by `@opentf/web-compiler`.

## Release CI artifacts

For each target already listed in the root `release.toml`, build both binaries:

```sh
cargo build --release -p otfw_cli --bins --target <triple>
```

CI currently stages only `otfwc`. Extend that artifact collection to include:

| Target | Source executable | Package archive |
| --- | --- | --- |
| `x86_64-unknown-linux-gnu` | `target/<triple>/release/otf-search` | `bin/linux-x64/otf-search.br` |
| `aarch64-apple-darwin` | `target/<triple>/release/otf-search` | `bin/darwin-arm64/otf-search.br` |
| `x86_64-apple-darwin` | `target/<triple>/release/otf-search` | `bin/darwin-x64/otf-search.br` |
| `x86_64-pc-windows-msvc` | `target/<triple>/release/otf-search.exe` | `bin/win32-x64/otf-search.exe.br` |

Keep the existing `otfwc[.exe].br` artifacts too. Use the same Brotli compression
as the compiler. `otfSearchPath()` lazily extracts the search archive, sets the
executable permission on Unix, and supports `OTF_SEARCH_BIN` for source builds.
A missing executable fails enabled search builds with an actionable error.

Release the updated `@opentf/web-compiler` before/with `@opentf/web-docs`, whose
runtime dependency must resolve to the version exporting `otfSearchPath` and
containing the binary. Also release `@opentf/web-cli`: its shared SSG helper now
propagates indexing failures instead of producing a successful build without search.
Versions and the release matrix are managed by the maintainer and release CI.

The package allowlist includes `search.js`; Pagefind is no longer a dependency.
`@opentf/web-docs/search` exposes the DOM-free reader. Built sites need only static
`_search` assets, not the native executable or a search server.

## Output-hook integration

Until esdev's output-hook contract lands, the existing SSG script calls
`indexWithOtfSearch({ siteDir, otfwc })` after prerendering. It operates on staged
release output. Development has no generated index; use a release preview to test.

The future `docsSearchPlugin` belongs in `@opentf/web-docs/build`. It must run once
for the completed prerendered site, before staged output is published. The hook
needs the actual staged output directory and explicit ordering after SSG. It must
skip ordinary dev/server compilation, register its generated assets with the
host's publication mechanism, and propagate failures. Do not infer this phase
from the compiler's per-module transform or metadata-only bundle hook.

## Deployment caching

Revalidate `_search/manifest.json`. Hash-named term chunks, document tables and
fragment generation directories are immutable. Retaining previous immutable
assets permits an already-open client to finish searching its original generation.
If an old payload is gone, the reader reports failure and reloads the manifest on
the next query. It never reads a new generation's fragments with old document IDs.
