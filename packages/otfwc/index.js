//! Resolve the `otfwc` compiler binary for the current platform.
//
// otfwc is a Rust binary distributed as prebuilt, per-platform npm packages
// (`@opentf/otfwc-<platform>-<arch>`), declared as optionalDependencies so npm
// installs only the one matching the host (the `os`/`cpu` fields gate the rest) —
// the same model rolldown/swc/esbuild use. The toolchain (`@opentf/web-cli`) calls
// `otfwcPath()` to get the executable path. `OTFWC_BIN` overrides everything (used
// in this repo's own dev to point at the cargo build).

import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// host key (`process.platform-process.arch`) → platform package name.
const PACKAGES = {
  "linux-x64": "@opentf/otfwc-linux-x64",
  "linux-arm64": "@opentf/otfwc-linux-arm64",
  "darwin-x64": "@opentf/otfwc-darwin-x64",
  "darwin-arm64": "@opentf/otfwc-darwin-arm64",
  "win32-x64": "@opentf/otfwc-win32-x64",
};

/** Absolute path to the otfwc executable, or throw with a clear message. */
export function otfwcPath() {
  if (process.env.OTFWC_BIN) {
    if (existsSync(process.env.OTFWC_BIN)) return process.env.OTFWC_BIN;
    throw new Error(`otfwc: OTFWC_BIN is set but ${process.env.OTFWC_BIN} does not exist`);
  }
  const key = `${process.platform}-${process.arch}`;
  const pkg = PACKAGES[key];
  if (!pkg) {
    throw new Error(
      `otfwc: no prebuilt binary for ${key}. Supported: ${Object.keys(PACKAGES).join(", ")}. ` +
        `Build from source and set OTFWC_BIN.`,
    );
  }
  const bin = process.platform === "win32" ? "otfwc.exe" : "otfwc";
  try {
    return require.resolve(`${pkg}/${bin}`);
  } catch {
    throw new Error(
      `otfwc: the platform package ${pkg} is not installed. ` +
        `Reinstall dependencies (it is an optionalDependency of @opentf/otfwc), or set OTFWC_BIN.`,
    );
  }
}
