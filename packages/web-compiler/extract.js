//! Decompress the host's otfwc binary from its shipped brotli archive.
//
// The package ships one brotli-compressed binary per platform under
// `bin/<platform>-<arch>/otfwc[.exe].br` (~0.65MB each vs ~2.3MB raw).
// `otfwcPath()` decompresses the host's archive lazily on first use.
//
// It runs under the ES-Runtime alongside the rest of the toolchain, so package
// installation needs no Node lifecycle hook.

import { chmod, exists, file, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { arch, env, platform } from "runtime:process";
import { resolve } from "runtime:build";

const here = dirname(fromFileURL(import.meta.url));

// A build can inline this resolver into a prerender entry. Resolve the installed
// package by name so its binary stays anchored to the package, not that bundle.
function packageDirectory() {
  try {
    return dirname(fromFileURL(import.meta.resolve("@opentf/web-compiler")));
  } catch {}
  // With pnpm the compiler may only be visible to the tool that depends on it.
  // Resolve from that installed module, rather than from the generated bundle.
  for (const tool of ["@opentf/esdev-plugin-web", "@opentf/web-cli/ssg"]) {
    try {
      const importer = resolve(tool, import.meta.url);
      return dirname(fromFileURL(resolve("@opentf/web-compiler", importer)));
    } catch {}
  }
  return here;
}

// The shipped `bin/` subdirectories are named the way node reports a host, which is
// not how the runtime does; map onto them rather than renaming what we publish.
const OS_NAMES = { linux: "linux", macos: "darwin", windows: "win32" };
const ARCH_NAMES = { x86_64: "x64", aarch64: "arm64" };

const SUPPORTED = new Set(["linux-x64", "darwin-x64", "darwin-arm64", "win32-x64"]);

function hostKey(platformName = platform, architecture = arch) {
  const os = OS_NAMES[platformName];
  const cpu = ARCH_NAMES[architecture];
  return os && cpu ? `${os}-${cpu}` : `${platformName}-${architecture}`;
}

function hostBinPath({ binaryDir = packageDirectory(), os = platform, cpuArch = arch } = {}) {
  const key = hostKey(os, cpuArch);
  if (!SUPPORTED.has(key)) return null;
  return join(binaryDir, "bin", key, os === "windows" ? "otfwc.exe" : "otfwc");
}

/** Decompress the host's `.br` archive to a runnable binary; returns its path. */
async function decompress(out, os = platform) {
  const compressed = await file(`${out}.br`).stream();
  const plain = compressed.pipeThrough(new DecompressionStream("brotli"));
  await write(out, new Uint8Array(await new Response(plain).arrayBuffer()));
  if (os !== "windows") await chmod(out, 0o755);
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
export async function otfwcPath({ binaryDir = packageDirectory(), environment = env, os = platform, cpuArch = arch } = {}) {
  if (environment.OTFWC_BIN) {
    if (await exists(environment.OTFWC_BIN)) return environment.OTFWC_BIN;
    throw new Error(`otfwc: OTFWC_BIN is set but ${environment.OTFWC_BIN} does not exist`);
  }
  const out = hostBinPath({ binaryDir, os, cpuArch });
  if (!out) {
    throw new Error(
      `otfwc: no prebuilt binary for ${hostKey(os, cpuArch)}. ` +
        `Supported: ${[...SUPPORTED].join(", ")}. Build from source and set OTFWC_BIN.`,
    );
  }
  if (await exists(out)) return out;
  if (await exists(`${out}.br`)) return decompress(out, os);
  throw new Error(
    `otfwc: prebuilt binary missing at ${out}. ` +
      `Reinstall @opentf/web-compiler, or set OTFWC_BIN.`,
  );
}
