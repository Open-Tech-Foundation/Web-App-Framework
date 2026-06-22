# @opentf/web-compiler

Prebuilt binaries for **otfwc**, the OTF Web IR compiler (a Rust binary). You
normally don't install this directly — `@opentf/web-cli` depends on it.

```js
import { otfwcPath } from "@opentf/web-compiler";
const bin = otfwcPath(); // absolute path to the otfwc executable for this platform
```

## How it works

This single package ships the `otfwc` binary for every supported platform,
**brotli-compressed**, under `bin/<platform>-<arch>/otfwc[.exe].br` (~0.65 MB each
vs ~2.3 MB raw). On install a `postinstall` script decompresses **only the host's**
binary; `otfwcPath()` also decompresses lazily as a fallback (e.g. under
`--ignore-scripts`) and returns the path matching the host
(`process.platform-process.arch`).

Shipping all platforms in one package is cheaper to maintain than the per-platform
optionalDependencies fan-out that rolldown/swc/esbuild use (their binaries are far
larger). `OTFWC_BIN` overrides everything (used in this repo's own dev to point at
the cargo `target/` build).

## Releasing (CI)

`bin/` is empty in git, and the package is `private: true` only as a guard so the
monorepo `changeset publish` doesn't ship it binary-less. It is published by its
own workflow, `.github/workflows/release-compiler.yml` (run manually after a
release): that cross-builds otfwc for each target, brotli-compresses each into
`bin/<platform>/`, flips `private` off, and publishes — so the package on npm is
public. Versioning is owned entirely by changesets — there is no version-sync
script.
