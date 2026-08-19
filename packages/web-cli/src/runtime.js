// Host primitives for the OTF Web toolchain on the ES-Runtime (`esdev`).
//
// Everything the toolchain needs from the host that is not the bundler. `runtime:fs`
// is async-only by design — there are no synchronous variants to fall back on — so the
// `node:fs` calls this toolchain grew up on become awaited helpers here. The rest is
// what Bun used to supply as globals: package resolution anchored at the *project*
// (not at this file), base64url without `Buffer`, and subprocesses.

import { copy, exists as fsExists, file, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, join } from "runtime:path";
import { Command } from "runtime:system";

// ------------------------------------------------------------------ filesystem

/**
 * Whether `path` exists. Also false when it sits outside the write/read grant —
 * a caller asking "is this here?" wants an answer, not a capability error.
 */
export async function exists(path) {
  try {
    return await fsExists(path);
  } catch {
    return false;
  }
}

/** Whether `path` exists *and* is a regular file (a directory must not be served). */
export async function isFile(path) {
  try {
    return (await stat(path)).isFile;
  } catch {
    return false;
  }
}

export const readText = (path) => file(path).text();
export const readBytes = (path) => file(path).bytes();

/** Write `data`, creating the parent directory — `writeFileSync` never had to be told. */
export async function writeFile(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await write(path, data);
}

export const mkdirp = (dir) => mkdir(dir, { recursive: true });

/** Remove a tree, tolerating "already gone" (the `force: true` of `rmSync`). */
export async function rmrf(dir) {
  try {
    await remove(dir, { recursive: true });
  } catch {}
}

/** Directory entries, or `[]` when the directory is missing. */
export async function readEntries(dir) {
  try {
    return await readDir(dir);
  } catch {
    return [];
  }
}

/**
 * Copy a directory tree. `copy()` takes one regular file at a time, which is the
 * honest primitive — `cpSync(dir, dir, { recursive: true })` was doing this walk
 * internally anyway.
 */
export async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readEntries(from)) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDir) await copyTree(src, dest);
    else if (entry.isFile) await copy(src, dest);
  }
}

/** Nearest ancestor directory of `from` (inclusive) that contains `name`. */
export async function findUp(name, from) {
  let dir = from;
  for (;;) {
    if (await exists(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------- base64url
//
// Route/worker/asset URLs carry the module's absolute path as base64url so it
// survives a URL path segment. There is no `Buffer` here, so it is `btoa`/`atob`
// over UTF-8 bytes with the URL alphabet substituted.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(s) {
  const bytes = enc.encode(s);
  let bin = "";
  // Chunked so a long path can't overflow the argument list of `fromCharCode`.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

// ------------------------------------------------------------------ resolution

/**
 * Resolve `sub` ("." or "./x") through a package's `exports` map, the way a node
 * resolver would. `conditions` are tried in order — JS wants `import`/`default`, a
 * stylesheet commonly sits behind `style`.
 */
export function throughExports(exports, sub, conditions = ["import", "default"]) {
  if (exports == null) return null;
  if (typeof exports === "string") return sub === "." ? exports : null;
  if (Array.isArray(exports)) {
    for (const e of exports) {
      const r = throughExports(e, sub, conditions);
      if (r) return r;
    }
    return null;
  }
  const keys = Object.keys(exports);
  if (keys.some((k) => k.startsWith("."))) {
    if (exports[sub] !== undefined) return throughExports(exports[sub], ".", conditions);
    for (const k of keys) {
      const star = k.indexOf("*"); // "./x/*" subpath patterns
      if (star < 0) continue;
      const pre = k.slice(0, star);
      const post = k.slice(star + 1);
      if (sub.length >= pre.length + post.length && sub.startsWith(pre) && sub.endsWith(post)) {
        const filled = sub.slice(pre.length, sub.length - post.length);
        const target = throughExports(exports[k], ".", conditions);
        if (target) return target.replace("*", filled);
      }
    }
    return null;
  }
  for (const c of conditions) {
    if (exports[c] !== undefined) return throughExports(exports[c], ".", conditions);
  }
  return null;
}

/**
 * Resolve a bare specifier to an absolute file, anchored at `fromDir` — the project
 * root, so the app's own copy of a package wins.
 *
 * `import.meta.resolve` cannot do this: it resolves against *this* module, which is
 * the CLI's location, not the project's. It is still the fallback for the case where
 * the walk finds nothing (an install layout that hoists somewhere unusual).
 */
export async function resolveFrom(spec, fromDir, conditions) {
  const m = /^((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/.exec(spec);
  if (!m) throw new Error(`cannot resolve ${JSON.stringify(spec)}`);
  const [, pkg, rest] = m;
  const sub = rest ? `./${rest}` : ".";

  for (let dir = fromDir; ; ) {
    const pkgDir = join(dir, "node_modules", pkg);
    const manifest = join(pkgDir, "package.json");
    if (await exists(manifest)) {
      let json = {};
      try {
        json = JSON.parse(await readText(manifest));
      } catch {}
      const target =
        throughExports(json.exports, sub, conditions) ??
        (sub === "." ? (json.module ?? json.main ?? "index.js") : rest);
      const abs = join(pkgDir, target);
      if (await exists(abs)) return abs;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  const url = import.meta.resolve(spec); // throws when it genuinely isn't installed
  return new URL(url).pathname;
}

/** The directory of the package that declares `name`, resolved from `fromDir`. */
export async function packageDir(name, fromDir) {
  const entry = await resolveFrom(name, fromDir);
  for (let dir = dirname(entry); ; ) {
    const manifest = join(dir, "package.json");
    if (await exists(manifest)) {
      try {
        if (JSON.parse(await readText(manifest)).name === name) return dir;
      } catch {}
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`cannot locate the ${name} package directory`);
    dir = up;
  }
}

// ------------------------------------------------------------------ subprocess

/**
 * Run a command to completion. `runtime:system` has no synchronous variant (also by
 * design), so the callers that used `Bun.spawnSync` await this instead.
 */
export async function run(program, args, { cwd, stdout = "piped", stderr = "piped" } = {}) {
  try {
    const out = await new Command(program, { args, cwd, stdout, stderr, inheritEnv: true }).output();
    return {
      ok: out.success,
      code: out.code,
      stdout: out.stdout ? dec.decode(out.stdout) : "",
      stderr: out.stderr ? dec.decode(out.stderr) : "",
    };
  } catch (e) {
    // A missing binary is a failed run, not a crash — callers report it themselves.
    return { ok: false, code: null, stdout: "", stderr: e?.message ?? String(e), error: e };
  }
}
