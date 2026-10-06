// Compiler service for the OTF Web esdev plugins: locate the `otfwc` binary
// and talk to it over its long-lived framed protocol.
//
// Everything here runs on `esdev` (`runtime:*` only — no `node:` builtins, no
// napi), which is what lets a framework dev server stop being a Node program.
// The bundler side lives in `./plugin.js`.

import { exists as fsExists } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env, exit } from "runtime:process";
import { Command } from "runtime:system";

import { otfwcPath } from "@opentf/web-compiler";

function fail(msg) {
  console.error(`✗ ${msg}`);
  exit(1);
}

/** `exists`, but a path outside the grant answers `false` instead of throwing. */
async function exists(path) {
  try {
    return await fsExists(path);
  } catch {
    return false;
  }
}

/** Nearest ancestor directory of `from` (inclusive) that contains `name`. */
async function findUp(name, from) {
  let dir = from;
  for (;;) {
    if (await exists(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Run a command to completion; a missing binary is `{ ok: false }`, not a crash. */
async function run(program, args, { cwd, stdout = "piped", stderr = "piped" } = {}) {
  try {
    const out = await new Command(program, { args, cwd, stdout, stderr, inheritEnv: true }).output();
    return { ok: out.success, code: out.code };
  } catch {
    return { ok: false, code: null };
  }
}

async function hasLocalCompilerWorkspace(workspace) {
  return !!workspace && (await exists(join(workspace, "crates", "otfw_cli", "Cargo.toml")));
}

export async function resolveCompiler({
  cliDir = dirname(fromFileURL(import.meta.url)),
  env: environment = env,
  resolvePackagedCompiler = otfwcPath,
  findWorkspace = findUp,
  ensure = ensureCompiler,
} = {}) {
  if (environment.OTFWC_BIN) return { otfwc: environment.OTFWC_BIN, workspace: null };

  let packagedError = null;
  try {
    return { otfwc: await resolvePackagedCompiler(), workspace: null };
  } catch (e) {
    packagedError = e;
  }

  const installedPackage = cliDir.split(/[\\/]/).includes("node_modules");
  const workspace = installedPackage ? null : await findWorkspace("Cargo.toml", cliDir);
  if (await hasLocalCompilerWorkspace(workspace)) {
    const otfwc = join(workspace, "target", "debug", "otfwc");
    await ensure(otfwc, workspace);
    return { otfwc, workspace };
  }

  fail(
    `${packagedError?.message ?? "cannot resolve @opentf/web-compiler prebuilt binary"}\n` +
      `  No local otfwc compiler workspace was found to build from source.`,
  );
}

async function ensureCompiler(otfwc, workspace) {
  if (await exists(otfwc)) return;
  if (!workspace) fail(`otfwc compiler not found at ${otfwc}`);
  console.log("building compiler (cargo build -p otfw_cli)…");
  const cargo = await run("cargo", ["--version"], { cwd: workspace, stdout: "null" });
  if (!cargo.ok) {
    fail(
      `cannot build otfwc because cargo is not available.\n` +
        `  This source checkout needs Rust/Cargo to build ${otfwc}.\n` +
        `  Install Rust in the build environment, set OTFWC_BIN to an existing otfwc binary,\n` +
        `  or build with the published @opentf/web-cli package so @opentf/web-compiler can use its prebuilt binary.`,
    );
  }
  const b = await run("cargo", ["build", "-p", "otfw_cli"], {
    cwd: workspace,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!b.ok) exit(b.code ?? 1);
}

/**
 * Turn an `ERR` reply payload into an `Error` carrying the compiler's diagnostic.
 * The payload is the JSON object `Diag::json` writes — `{ file, message, line,
 * column, frame, note }` — so the position survives as data all the way to the browser
 * overlay instead of being flattened into prose. An older compiler (or a protocol
 * error) sends a bare string; that still works, it just has no position.
 *
 * `error.message` is the one-line human form (`path:line:col message`), `error.diag`
 * the structured fields, and `error.text` the full terminal rendering with the frame.
 */
export function compileError(payload) {
  let d = null;
  if (payload.startsWith("{")) {
    try {
      d = JSON.parse(payload);
    } catch {}
  }
  if (!d?.message) {
    const err = new Error(payload);
    err.diag = { message: payload };
    err.text = payload;
    return err;
  }
  const where = d.line ? `${d.file}:${d.line}:${d.column}` : d.file;
  const err = new Error(`${where}: ${d.message}`);
  err.diag = d;
  err.text =
    `${where}: ${d.message}\n` + (d.note ? `note: ${d.note}\n` : "") + (d.frame ? `\n${d.frame}` : "");
  return err;
}

/**
 * Start a long-lived `otfwc serve` process and talk to it over a framed
 * stdin/stdout protocol (see crates/otfw_cli/src/main.rs `serve`). One process
 * compiles every module, so the toolchain pays the binary-startup cost once
 * instead of spawning a subprocess per file — the dominant dev-server cost.
 *
 * `compile(id, source, component, target)` resolves to the emitted JS or rejects
 * with the compiler diagnostic (`target` is `"csr"` | `"ssg"` | `"hydrate"`).
 * With `{ sourceMap: true }`, success resolves to `{ code, map }`. Older
 * binaries still compile, returning `map: null`. The request framing is unchanged.
 * Requests are serialized through a FIFO queue: the server
 * is single-threaded, replies arrive in request order, so the head of the queue
 * always pairs with the next frame. The child is killed when this process exits.
 */
// Every compiler child started in this process, so a one-shot command can shut them
// all down. It has to: an open reader on a child's stdout keeps the runtime alive, so
// a prerender step that simply returned would hang after its output is written.
const compilers = new Set();

/** Stop every `otfwc serve` child. Called at the end of the one-shot commands. */
export async function closeCompilers() {
  await Promise.all([...compilers].map((close) => close()));
  compilers.clear();
}

export function startCompilerServer(otfwc, { sourceMap = false } = {}) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const queue = []; // { resolve, reject } in request order
  let buf = new Uint8Array(0);
  let pumping = false;
  let dead = false;
  let started = null;

  const append = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const die = (err) => {
    dead = true;
    while (queue.length) queue.shift().reject(err);
  };

  // Spawning is async here, so the child is started on the first compile rather than
  // when the plugin is constructed — a build that never touches a `.jsx` never pays
  // for it. Nothing awaits the child's exit, so it holds nothing open; when this
  // process goes, the child sees EOF on its stdin and stops.
  let reading = null; // the stdout reader, so `close` can release it

  function start() {
    started ??= new Command(otfwc, {
      args: sourceMap ? ["serve", "--sourcemap"] : ["serve"],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    })
      .spawn()
      .then((proc) => {
        reading = proc.stdout.getReader();
        return { proc, writer: proc.stdin.getWriter(), reader: reading };
      });
    return started;
  }

  // Drain reply frames as they arrive, resolving queued requests in order. A frame
  // is `<status> <byteLen>\n` followed by exactly `byteLen` bytes of payload.
  async function pump(reader) {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        let nl = buf.indexOf(10);
        while (nl === -1) {
          const { value, done } = await reader.read();
          if (done) return die(new Error("otfwc serve exited"));
          buf = append(buf, value);
          nl = buf.indexOf(10);
        }
        const [status, lenStr] = dec.decode(buf.subarray(0, nl)).split(" ");
        const len = Number(lenStr);
        while (buf.length < nl + 1 + len) {
          const { value, done } = await reader.read();
          if (done) return die(new Error("otfwc serve exited"));
          buf = append(buf, value);
        }
        const payload = dec.decode(buf.subarray(nl + 1, nl + 1 + len));
        buf = buf.slice(nl + 1 + len);
        const job = queue.shift();
        if (status === "MAP") job.resolve(JSON.parse(payload));
        // Older packaged binaries ignore --sourcemap and return plain OK frames.
        // Keep them usable; they cannot provide mappings until upgraded.
        else if (status === "OK") job.resolve(sourceMap ? { code: payload, map: null } : payload);
        else job.reject(compileError(payload));
      }
    } finally {
      pumping = false;
    }
  }

  // Replies are paired with requests by position, so the frames must reach the child
  // in the order their promises were queued. Writing to a `WritableStream` is async,
  // so the writes are chained rather than merely awaited per call — two concurrent
  // `compile()`s would otherwise interleave their header and payload bytes.
  let writes = Promise.resolve();

  function compile(id, source, component, target = "csr") {
    if (dead) return Promise.reject(new Error("otfwc serve is not running"));
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      writes = writes
        .then(async () => {
          const { writer, reader } = await start();
          const idB = enc.encode(id);
          const srcB = enc.encode(source);
          await writer.write(enc.encode(`${idB.length} ${srcB.length} ${component ? 1 : 0} ${target}\n`));
          await writer.write(idB);
          await writer.write(srcB);
          pump(reader);
        })
        .catch(die);
    });
  }

  async function close() {
    compilers.delete(close);
    if (dead) return;
    dead = true;
    if (!started) return;
    try {
      const { proc, writer } = await started;
      try {
        await writer.close();
      } catch {}
      // Releasing the reader matters as much as killing the child: an outstanding
      // reader on a child's stdout is itself a reason for the runtime to stay up.
      try {
        await reading?.cancel();
      } catch {}
      proc.kill();
    } catch {}
  }

  compilers.add(close);
  return { compile, close };
}
