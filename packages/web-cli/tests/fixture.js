// Temp-project helpers for the unit tests.
//
// The runtime jails the filesystem to the project root, so a test scratch directory
// lives beside the tests rather than in the OS temp dir — and is anchored to this
// file, not the runner's working directory, so the suites pass from anywhere.

import { makeTempDir, mkdir, remove, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";

const HERE = dirname(fromFileURL(import.meta.url));

/** A fresh empty directory under tests/. Remove it with `discard`. */
export const tempDir = (prefix) => makeTempDir({ dir: HERE, prefix: `${prefix}-` });

/** Remove a temp tree. Never throws — a cleanup failure must not fail the test. */
export async function discard(dir) {
  try {
    await remove(dir, { recursive: true });
  } catch {
    // already gone, or never created
  }
}

/** Write a file, creating the directories above it. */
export async function writeFile(path, content = "") {
  await mkdir(dirname(path), { recursive: true });
  await write(path, content);
}

/** Write a `{ "rel/path": "content" }` map under `dir`. */
export async function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) await writeFile(join(dir, rel), content);
}
