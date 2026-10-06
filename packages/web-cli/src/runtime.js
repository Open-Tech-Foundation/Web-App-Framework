// Host primitives for the SSG library on the ES-Runtime (`esdev`).
//
// Everything the prerender needs from the host that is not the bundler: awaited
// filesystem helpers (`runtime:fs` is async-only by design) and package
// resolution anchored at the *project* rather than at this file.

import { exists as fsExists, file, mkdir, readDir, realPath, remove, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";

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

export const readText = (path) => file(path).text();

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
 * root, so the app's own copy of a package wins. Return its canonical path so
 * aliases and package imports share one module instance under symlinked installs.
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
      if (await exists(abs)) return realPath(abs);
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  return realPath(fromFileURL(import.meta.resolve(spec)));
}
