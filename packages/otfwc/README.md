# @opentf/otfwc

Prebuilt-binary resolver for **otfwc**, the OpenTF Web IR compiler (a Rust binary).
You normally don't install this directly — `@opentf/web-cli` depends on it.

```js
import { otfwcPath } from "@opentf/otfwc";
const bin = otfwcPath(); // absolute path to the otfwc executable for this platform
```

## How it works

otfwc ships as per-platform packages (`@opentf/otfwc-linux-x64`,
`@opentf/otfwc-darwin-arm64`, …) declared here as `optionalDependencies`. npm
installs only the one matching the host (gated by each package's `os`/`cpu`
fields) — the same model as rolldown/swc/esbuild. `otfwcPath()` resolves that
package's binary. `OTFWC_BIN` overrides everything (used in this repo's own dev to
point at the cargo `target/` build).

## Releasing (CI)

The per-platform packages under `npm/<platform>/` hold only a `package.json` in
git; the release workflow (`.github/workflows/release.yml`) cross-builds otfwc for
each target, drops the binary into the matching `npm/<platform>/` dir, and
publishes the platform packages alongside `@opentf/otfwc`. Keep the
`optionalDependencies` versions in lockstep with this package's version.
