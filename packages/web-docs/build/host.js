// Host primitives for the docs build hooks.
//
// These run inside the toolchain, on the ES-Runtime, where the filesystem is async
// only — there are no synchronous variants to fall back on. A small local shim keeps
// the plugins readable and avoids a build-time dependency on `@opentf/web-cli`, whose
// equivalent helpers are private to it.

import { exists as fsExists, file, readDir } from "runtime:fs";
import { Command } from "runtime:system";

/** Whether `path` exists — false rather than throwing when it is out of reach. */
export async function exists(path) {
  try {
    return await fsExists(path);
  } catch {
    return false;
  }
}

export const readText = (path) => file(path).text();

/** Directory entries, or `[]` when the directory is missing. */
export async function readEntries(dir) {
  try {
    return await readDir(dir);
  } catch {
    return [];
  }
}

/** Entry names only — the `readdirSync(dir)` shape. */
export async function readNames(dir) {
  return (await readEntries(dir)).map((e) => e.name);
}

/**
 * Run a command and return its trimmed stdout, or null if it failed. Git is the only
 * caller, and a repo-less checkout must degrade to "no last-updated", never throw.
 */
export async function runOut(program, args, cwd) {
  try {
    const out = await new Command(program, {
      args,
      cwd,
      stdout: "piped",
      stderr: "null",
      inheritEnv: true,
    }).output();
    if (!out.success) return null;
    return new TextDecoder().decode(out.stdout).trim();
  } catch {
    return null;
  }
}
