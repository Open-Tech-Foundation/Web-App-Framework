//! Decompress the host's otfwc binary from its shipped brotli archive.
//
// The package ships one brotli-compressed binary per platform under
// `bin/<platform>-<arch>/otfwc[.exe].br` (~0.65MB each vs ~2.3MB raw). On install
// the postinstall script decompresses only the host's; `otfwcPath()` also does it
// lazily as a fallback (e.g. when scripts are skipped with --ignore-scripts).

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// `process.platform-process.arch` maps directly onto our bin/ subdirectory names.
const SUPPORTED = new Set([
  "linux-x64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
]);

function hostBinPath() {
  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.has(key)) return null;
  const bin = process.platform === "win32" ? "otfwc.exe" : "otfwc";
  return join(here, "bin", key, bin);
}

/** Decompress the host's `.br` archive to a runnable binary; returns its path. */
function decompress(out) {
  const archive = `${out}.br`;
  writeFileSync(out, brotliDecompressSync(readFileSync(archive)));
  if (process.platform !== "win32") chmodSync(out, 0o755);
  return out;
}

/**
 * Best-effort: decompress the host binary if the archive is present. No-op (returns
 * null) on an unsupported platform or a source checkout without the `.br`. Used by
 * the postinstall script — never throws, so it can't break `npm install`.
 */
export function extractIfPackaged() {
  const out = hostBinPath();
  if (!out || existsSync(out) || !existsSync(`${out}.br`)) return null;
  try {
    return decompress(out);
  } catch {
    return null; // lazy fallback in otfwcPath() will retry / surface the error
  }
}

/** Absolute path to the otfwc executable, or throw with a clear message. */
export function otfwcPath() {
  if (process.env.OTFWC_BIN) {
    if (existsSync(process.env.OTFWC_BIN)) return process.env.OTFWC_BIN;
    throw new Error(`otfwc: OTFWC_BIN is set but ${process.env.OTFWC_BIN} does not exist`);
  }
  const out = hostBinPath();
  if (!out) {
    throw new Error(
      `otfwc: no prebuilt binary for ${process.platform}-${process.arch}. ` +
        `Supported: ${[...SUPPORTED].join(", ")}. Build from source and set OTFWC_BIN.`,
    );
  }
  if (existsSync(out)) return out;
  if (existsSync(`${out}.br`)) return decompress(out);
  throw new Error(
    `otfwc: prebuilt binary missing at ${out}. ` +
      `Reinstall @opentf/web-compiler, or set OTFWC_BIN.`,
  );
}
