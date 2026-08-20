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

import { makeTempDir } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env, exit } from "runtime:process";
import { Command } from "runtime:system";

import {
  b64url,
  exists,
  isFile,
  mkdirp,
  readBytes,
  readEntries,
  readText,
  rmrf,
  writeFile,
} from "../../src/runtime.js";

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

// The toolchain's own host helpers — the same `exists`/`readText`/`rmrf` the CLI runs
// on, so an e2e reads the tree the way the code under test does.
export { b64url, exists, isFile, mkdirp, readBytes, readEntries, readText, rmrf, writeFile };

/** The names in a directory, or none when it is missing. */
export const readNames = async (dir) => (await readEntries(dir)).map((e) => e.name);

/**
 * Point `link` at `target`. `runtime:fs` can read a symlink but not make one, so this
 * is `ln -s` — a fixture that reaches a dependency through a workspace-style link is
 * the whole point of the worker-assets e2e, and a copy would not reproduce it.
 */
export async function symlink(target, link) {
  await mkdirp(dirname(link));
  const { code } = await new Command("ln", { args: ["-sfn", target, link] }).output();
  if (code !== 0) throw new Error(`could not link ${link} -> ${target}`);
}

/** Write a whole tree, `{ "app/page.jsx": "…" }`, relative to `dir`. */
export async function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) await writeFile(join(dir, rel), content);
}

// Everything a build leaves behind in a fixture app. `dist` is the output; the rest
// are the staging directories the phases compile through, each named for its phase.
const ARTIFACTS = [
  "dist",
  ".otfw",
  ".otfw-ssg",
  ".otfw-csr-head",
  ".otfw-api",
  ".otfw-api-build",
  ".otfw-loaders",
  ".otfw-loaders-build",
  ".dev",
];

// Where a test's generated trees go. It has to be inside the sandbox — the working
// directory is the only place this process may write, so the system temp dir is out —
// and it has to be at the top of the workspace rather than beside these files: the
// packages are symlinked into each other's `node_modules`, and a generated app under
// one of them has a second path that reads as vendored. The dev server ignores
// anything under `node_modules`, so a watcher event for such an app never arrives.
const SCRATCH = join(ROOT, ".e2e");

/** A named scratch tree, replacing whatever a previous run left there. */
export async function scratch(name) {
  const dir = join(SCRATCH, name);
  await rmrf(dir);
  await mkdirp(dir);
  return dir;
}

/** A fresh scratch tree with a generated name, for a test that needs more than one. */
export async function tempDir(prefix) {
  await mkdirp(SCRATCH);
  return makeTempDir({ dir: SCRATCH, prefix: `${prefix}-` });
}

/** Put a fixture app back the way it was checked in. */
export const cleanFixture = (fixture) =>
  Promise.all(ARTIFACTS.map((d) => rmrf(join(fixture, d))));

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
const command = (args, { root, env: extra, stderr = "inherit" } = {}) =>
  new Command("esdev", {
    args: [CLI, ...args, ...(root ? [`--root=${root}`] : [])],
    cwd: ROOT,
    env: { OTFWC_BIN: OTFWC, ...extra },
    inheritEnv: true,
    stdout: "piped",
    stderr,
  });

export const cli = (args, options) => command(args, options).spawn();

/** Run any program to completion and decode what it wrote. */
export async function exec(program, args, { cwd, env: extra } = {}) {
  const result = await new Command(program, {
    args,
    cwd,
    env: extra,
    inheritEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    out: decoder.decode(result.stdout),
    err: decoder.decode(result.stderr),
  };
}

/** The same, for a command that finishes on its own: run it, collect what it said. */
export async function cliRun(args, options) {
  const result = await command(args, { stderr: "piped", ...options }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    out: decoder.decode(result.stdout),
    err: decoder.decode(result.stderr),
  };
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

/**
 * Read a stream to its end and discard it, so a long-running child never blocks on a
 * full stdout pipe once the line the test was waiting for has gone by.
 */
export async function drain(stream) {
  const reader = stream.getReader();
  try {
    for (;;) if ((await reader.read()).done) return;
  } catch {
    /* the child is gone */
  } finally {
    reader.releaseLock();
  }
}

/**
 * Start `otfw dev` on the app at `root`, on a free high port.
 *
 * Not the default 3000: a developer's own server (and the browser tab pointed at it)
 * commonly owns that one, and it would answer these requests — or take the reloads
 * meant for the test. A port we pick can still be taken, so a busy one is retried.
 */
export async function startDevServer(root, { portBase, attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const port = portBase + Math.floor(Math.random() * 2000);
    const proc = await cli(["dev", `--port=${port}`], { root });
    try {
      await waitForOutput(
        proc.stdout,
        (buf) => buf.includes(`localhost:${port}`) && /ready in/.test(buf),
        { what: `the dev server on port ${port}` },
      );
    } catch (e) {
      await stop(proc);
      if (i === attempts - 1) throw e;
      continue;
    }
    // Keep draining so the child never blocks on a full stdout pipe.
    void drain(proc.stdout);
    return { proc, port };
  }
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
    () => console.log(`\n✓ ${name}${passed() ? ` — ${passed()} assertions passed` : ""}\n`),
    (e) => {
      console.error(`\n✗ ${e?.stack ?? e?.message ?? e}\n`);
      exit(1);
    },
  );
}
