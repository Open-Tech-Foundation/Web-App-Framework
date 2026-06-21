//! Resolve the `otfwc` compiler binary for the current platform.
//
// otfwc is a Rust binary. It ships prebuilt for every supported platform inside
// this single package under `bin/<platform>-<arch>/` — the host's binary is ~1.8MB,
// so bundling all of them costs only a few MB total (no optionalDependencies fan-out
// to maintain). The toolchain (`@opentf/web-cli`) calls `otfwcPath()` to get the
// executable path. `OTFWC_BIN` overrides everything (used in this repo's own dev to
// point at the cargo build).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// `process.platform-process.arch` maps directly onto our bin/ subdirectory names.
const SUPPORTED = new Set([
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
]);

/** Absolute path to the otfwc executable, or throw with a clear message. */
export function otfwcPath() {
  if (process.env.OTFWC_BIN) {
    if (existsSync(process.env.OTFWC_BIN)) return process.env.OTFWC_BIN;
    throw new Error(`otfwc: OTFWC_BIN is set but ${process.env.OTFWC_BIN} does not exist`);
  }
  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.has(key)) {
    throw new Error(
      `otfwc: no prebuilt binary for ${key}. Supported: ${[...SUPPORTED].join(", ")}. ` +
        `Build from source and set OTFWC_BIN.`,
    );
  }
  const bin = process.platform === "win32" ? "otfwc.exe" : "otfwc";
  const path = join(here, "bin", key, bin);
  if (!existsSync(path)) {
    throw new Error(
      `otfwc: prebuilt binary missing at ${path}. ` +
        `Reinstall @opentf/web-compiler, or set OTFWC_BIN.`,
    );
  }
  return path;
}
