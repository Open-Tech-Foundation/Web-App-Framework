# @opentf/web-compiler

Prebuilt binaries for **otfwc**, the OTF Web IR compiler (a Rust binary). You
normally don't install this directly — `@opentf/web-cli` depends on it.

```js
import { otfwcPath } from "@opentf/web-compiler";
const bin = otfwcPath(); // absolute path to the otfwc executable for this platform
```

## How it works

This single package ships the prebuilt `otfwc` binary for every supported platform
under `bin/<platform>-<arch>/`. `otfwcPath()` returns the one matching the host
(`process.platform-process.arch`). The host binary is ~1.8 MB, so shipping all of
them is only a few MB total — cheaper to maintain than the per-platform
optionalDependencies fan-out that rolldown/swc/esbuild use (their binaries are far
larger). `OTFWC_BIN` overrides everything (used in this repo's own dev to point at
the cargo `target/` build).

## Releasing (CI)

`bin/` is empty in git (only `.gitignore` is tracked). The release workflow
(`.github/workflows/release.yml`) cross-builds otfwc for each target, stages every
binary into `bin/<platform>/`, and publishes this one package. Versioning is owned
entirely by changesets — there is no version-sync script.
