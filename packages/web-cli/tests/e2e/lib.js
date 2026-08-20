// What every e2e script needs and none of them should own: where the workspace is,
// how to say an assertion held, how to start the real CLI and wait for it to be up.
//
// These are programs, not `runtime:test` files — an e2e drives a server it started
// and reports at the end, which is a main() with a finally, not a set of independent
// cases. Run one directly:
//
//   esdev packages/web-cli/tests/e2e/serve.mjs
//
// from the repository root, so the paths below stay inside the sandbox.

import { exists, mkdir, readDir, remove, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env, exit } from "runtime:process";
import { Command } from "runtime:system";

export const HERE = dirname(fromFileURL(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..", "..");
export const CLI = join(ROOT, "packages", "web-cli", "src", "cli.js");
export const OTFWC = env.OTFWC_BIN ?? join(ROOT, "target", "debug", "otfwc");

/* ------------------------------------------------------------------ assertions */

let count = 0;

export const passed = () => count;
export const ok = (label) => void (count++, console.log(`  ✓ ${label}`));

export function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SSG markup interleaves hydration markers (`todo <!--$-->alpha<!--/-->`); strip them
// so assertions can match the text a browser would show.
export const visibleText = (html) => html.replace(/<!--[^>]*-->/g, "");

/* -------------------------------------------------------------------- the file */

/** `rm -rf`, and no complaint about what was not there to begin with. */
export const rmrf = (path) => remove(path, { recursive: true }).catch(() => {});

/** Write a file, making the directories above it first. */
export async function writeFile(path, content = "") {
  await mkdir(dirname(path), { recursive: true });
  await write(path, content);
}

/** Write a whole tree, `{ "app/page.jsx": "…" }`, relative to `dir`. */
export async function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) await writeFile(join(dir, rel), content);
}

export { exists, readDir };

/** Everything a build leaves behind in a fixture app, gone. */
export function cleanFixture(fixture) {
  return Promise.all(
    [
      "dist",
      ".otfw",
      ".otfw-ssg",
      ".otfw-api",
      ".otfw-loaders",
      ".otfw-loaders-build",
      ".dev",
    ].map((d) => rmrf(join(fixture, d))),
  );
}

/* ----------------------------------------------------------------- the children */

/**
 * Start the toolchain CLI on the runtime that ships it, against the app at `root`.
 *
 * The child runs from the workspace, never from the app: the runtime's sandbox is the
 * working directory, so a child started inside a fixture could not load the CLI above
 * it. The workspace contains both, and `--root` names which app to act on — the same
 * arrangement `bun run dev` uses against `playground/`.
 *
 * `OTFWC_BIN` points the child at the workspace compiler build, which is the one under
 * test; the packaged binary a released install would use is not in a checkout.
 */
export function cli(args, { root, env: extra, stderr = "inherit" } = {}) {
  return new Command("esdev", {
    args: [CLI, ...args, ...(root ? [`--root=${root}`] : [])],
    cwd: ROOT,
    env: { OTFWC_BIN: OTFWC, ...extra },
    inheritEnv: true,
    stdout: "piped",
    stderr,
  }).spawn();
}

/** Stop a child and wait for it, whatever state it is in. */
export async function stop(proc) {
  try {
    proc.kill();
    await proc.status;
  } catch {
    /* already gone */
  }
}

/**
 * Read `stream` until `match` finds something in what has arrived so far, and return
 * that. The whole text read is attached to the failure, because what a server printed
 * before giving up is the only account of why it never started.
 */
export async function waitForOutput(stream, match, { timeoutMs = 60000, what = "output" } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buf = "";
  try {
    for (;;) {
      const found = match(buf);
      if (found !== undefined && found !== null && found !== false) return found;
      if (Date.now() > deadline) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`never saw ${what} in ${timeoutMs}ms:\n${buf}`);
}

/** The port an `otfw dev`/`otfw serve` child announces once it is listening. */
export const waitForReady = (proc, timeoutMs) =>
  waitForOutput(
    proc.stdout,
    (buf) => {
      const m = buf.match(/http:\/\/localhost:(\d+)/);
      return m && /ready in/.test(buf) ? Number(m[1]) : null;
    },
    { timeoutMs, what: "the server's ready line" },
  );

/* ---------------------------------------------------------------------- the run */

/** Run an e2e's body, report how it went, and set the exit code accordingly. */
export function run(name, body) {
  return body().then(
    () => console.log(`\n✓ ${name} — ${passed()} assertions passed\n`),
    (e) => {
      console.error(`\n✗ ${e?.stack ?? e?.message ?? e}\n`);
      exit(1);
    },
  );
}
