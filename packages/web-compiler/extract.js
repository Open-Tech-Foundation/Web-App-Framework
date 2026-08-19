//! Decompress the host's otfwc binary from its shipped brotli archive.
//
// The package ships one brotli-compressed binary per platform under
// `bin/<platform>-<arch>/otfwc[.exe].br` (~0.65MB each vs ~2.3MB raw). On install
// the postinstall script decompresses only the host's; `otfwcPath()` also does it
// lazily as a fallback (e.g. when scripts are skipped with --ignore-scripts).
//
// This is the runtime half, and it runs under the ES-Runtime alongside the rest of
// the toolchain. The install half is `scripts/postinstall.js`, which npm runs under
// node and which therefore carries its own copy of this logic.

import { chmod, exists, file, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { arch, env, platform } from "runtime:process";

const here = dirname(fromFileURL(import.meta.url));

// The shipped `bin/` subdirectories are named the way node reports a host, which is
// not how the runtime does; map onto them rather than renaming what we publish.
const OS_NAMES = { linux: "linux", macos: "darwin", windows: "win32" };
const ARCH_NAMES = { x86_64: "x64", aarch64: "arm64" };

const SUPPORTED = new Set(["linux-x64", "darwin-x64", "darwin-arm64", "win32-x64"]);

function hostKey() {
  const os = OS_NAMES[platform];
  const cpu = ARCH_NAMES[arch];
  return os && cpu ? `${os}-${cpu}` : `${platform}-${arch}`;
}

function hostBinPath() {
  const key = hostKey();
  if (!SUPPORTED.has(key)) return null;
  return join(here, "bin", key, platform === "windows" ? "otfwc.exe" : "otfwc");
}

/** Decompress the host's `.br` archive to a runnable binary; returns its path. */
async function decompress(out) {
  const compressed = await file(`${out}.br`).stream();
  const plain = compressed.pipeThrough(new DecompressionStream("brotli"));
  await write(out, new Uint8Array(await new Response(plain).arrayBuffer()));
  if (platform !== "windows") await chmod(out, 0o755);
  return out;
}

/**
 * Best-effort: decompress the host binary if the archive is present. No-op (returns
 * null) on an unsupported platform or a source checkout without the `.br`. Never
 * throws — the caller falls back to reporting the missing binary itself.
 */
export async function extractIfPackaged() {
  const out = hostBinPath();
  if (!out) return null;
  try {
    if ((await exists(out)) || !(await exists(`${out}.br`))) return null;
    return await decompress(out);
  } catch {
    return null;
  }
}

/** Absolute path to the otfwc executable, or throw with a clear message. */
export async function otfwcPath() {
  if (env.OTFWC_BIN) {
    if (await exists(env.OTFWC_BIN)) return env.OTFWC_BIN;
    throw new Error(`otfwc: OTFWC_BIN is set but ${env.OTFWC_BIN} does not exist`);
  }
  const out = hostBinPath();
  if (!out) {
    throw new Error(
      `otfwc: no prebuilt binary for ${hostKey()}. ` +
        `Supported: ${[...SUPPORTED].join(", ")}. Build from source and set OTFWC_BIN.`,
    );
  }
  if (await exists(out)) return out;
  if (await exists(`${out}.br`)) return decompress(out);
  throw new Error(
    `otfwc: prebuilt binary missing at ${out}. ` +
      `Reinstall @opentf/web-compiler, or set OTFWC_BIN.`,
  );
}
