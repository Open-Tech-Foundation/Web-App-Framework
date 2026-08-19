//! Decompress the host's otfwc binary after install. Best-effort: a no-op on a
//! source checkout (no `.br` present) and never throws, so it can't break install.
//! `otfwcPath()` decompresses lazily anyway if this is skipped (--ignore-scripts).
//
// npm runs install hooks under node, so this cannot share `../extract.js` — that is
// the runtime half and imports `runtime:` modules. The two are kept deliberately
// small and must agree on the `bin/<platform>-<arch>/` layout and nothing else.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

const SUPPORTED = new Set(["linux-x64", "darwin-x64", "darwin-arm64", "win32-x64"]);

try {
  const key = `${process.platform}-${process.arch}`;
  if (SUPPORTED.has(key)) {
    const bin = process.platform === "win32" ? "otfwc.exe" : "otfwc";
    const out = join(here, "..", "bin", key, bin);
    if (!existsSync(out) && existsSync(`${out}.br`)) {
      writeFileSync(out, brotliDecompressSync(readFileSync(`${out}.br`)));
      if (process.platform !== "win32") chmodSync(out, 0o755);
    }
  }
} catch {
  // Left for the lazy fallback in otfwcPath() to retry or report.
}
