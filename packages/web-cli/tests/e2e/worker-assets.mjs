// End-to-end test for the `new Worker(new URL(…, import.meta.url))` + bare
// `new URL(…, import.meta.url)` conventions (the web-worker bug: Rolldown left
// these as dangling runtime strings, so the worker/wasm files 404'd).
//
// Covers every toolchain path against a real project:
//   • `otfw build`       — workerAssetsPlugin emits the worker as its own hashed
//     chunk (recursing into nested workers) and the .wasm as a hashed asset,
//     rewriting each reference to the emitted file.
//   • `otfw build --ssg` — same client bundle, plus a pre-render pass that must not
//     choke on the module-top-level `new URL(…)`; the static pages reference the
//     emitted worker/asset chunks in /assets.
//   • `otfw dev`         — the /__worker & /__asset dev routes serve the same files
//     on demand, with the source reference rewritten to those URLs.
//
//   bun packages/web-cli/tests/e2e/worker-assets.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides).

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI = ROOT + "packages/web-cli/src/cli.js";
const FIXTURE = HERE + "worker-fixture";
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const PAGE = FIXTURE + "/app/page.jsx";
const PORT = 3987;

let passed = 0;
const ok = (label) => (passed++, console.log(`  ✓ ${label}`));
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}

function cleanFixture() {
  for (const d of ["dist", ".otfw", ".dev"]) {
    rmSync(`${FIXTURE}/${d}`, { recursive: true, force: true });
  }
}

// `mode` is "csr" (plain `otfw build`) or "ssg" (`otfw build --ssg`). Both bundle
// the client the same way, so both must emit/rewrite the worker + asset; SSG also
// pre-renders, which must not choke on the module-top-level `new URL(…)`.
async function testBuild(mode) {
  cleanFixture();
  const args = mode === "ssg" ? ["build", "--ssg", "--base-url=https://example.com"] : ["build"];
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: FIXTURE,
    env: { ...process.env, OTFWC_BIN: OTFWC },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`build (${mode}) exited ${code}:\n${out}\n${err}`);
  ok(`otfw build (${mode}) completes`);

  if (mode === "ssg") {
    // The pre-rendered page exists and points at the emitted client bundle in
    // /assets — so the worker/asset chunks it references are served alongside it.
    const html = readFileSync(`${FIXTURE}/dist/index.html`, "utf8");
    assert(html.includes("WORKER_E2E"), "SSG pre-rendered the page HTML");
    assert(/\/assets\/bundle-.*\.js/.test(html), "SSG page loads the hashed client bundle");
  }

  const assets = readdirSync(`${FIXTURE}/dist/assets`);

  // Worker + nested worker are emitted as their own hashed chunks…
  assert(assets.some((f) => /^counter-worker-.*\.js$/.test(f)), `[${mode}] worker chunk emitted (counter-worker-*.js)`);
  assert(assets.some((f) => /^nested-worker-.*\.js$/.test(f)), `[${mode}] nested worker chunk emitted (nested-worker-*.js)`);
  // …the .wasm asset referenced from the page is emitted with a hash…
  assert(assets.some((f) => /^pixel-.*\.wasm$/.test(f)), `[${mode}] wasm asset emitted (pixel-*.wasm)`);
  // …and the .wasm asset referenced from *inside the worker* is emitted too (the
  // emitted worker chunk was re-scanned for its own new URL assets).
  assert(assets.some((f) => /^kernel-.*\.wasm$/.test(f)), `[${mode}] worker-scoped wasm asset emitted (kernel-*.wasm)`);

  // The nested worker's real source made it into its chunk (not a stub / 404).
  const nested = assets.find((f) => /^nested-worker-.*\.js$/.test(f));
  assert(
    readFileSync(`${FIXTURE}/dist/assets/${nested}`, "utf8").includes("MARKER_NESTED_WORKER"),
    `[${mode}] nested worker chunk carries the real worker source`,
  );
  // The worker chunk points at the hashed kernel asset, not the raw literal.
  const counter = assets.find((f) => /^counter-worker-.*\.js$/.test(f));
  const counterCode = readFileSync(`${FIXTURE}/dist/assets/${counter}`, "utf8");
  assert(/kernel-.*\.wasm/.test(counterCode), `[${mode}] worker chunk references the hashed kernel asset`);
  assert(!counterCode.includes('"./kernel.wasm"'), `[${mode}] worker chunk drops the raw ./kernel.wasm literal`);

  // No dangling literal references survive anywhere in the emitted JS.
  const allJs = assets
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(`${FIXTURE}/dist/assets/${f}`, "utf8"))
    .join("\n");
  assert(!/["'`]\.\/counter-worker\.js["'`]/.test(allJs), `[${mode}] no dangling ./counter-worker.js literal remains`);
  assert(!/["'`]\.\/nested-worker\.js["'`]/.test(allJs), `[${mode}] no dangling ./nested-worker.js literal remains`);
  assert(!/["'`]\.\/pixel\.wasm["'`]/.test(allJs), `[${mode}] no dangling ./pixel.wasm literal remains`);
  assert(!/["'`]\.\/kernel\.wasm["'`]/.test(allJs), `[${mode}] no dangling ./kernel.wasm literal remains`);
}

async function waitForServer(base, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + "/bundle.js");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("dev server did not become ready");
}

async function testDev() {
  const base = `http://localhost:${PORT}`;
  const proc = Bun.spawn(["bun", CLI, "dev", "--port", String(PORT)], {
    cwd: FIXTURE,
    env: { ...process.env, OTFWC_BIN: OTFWC },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForServer(base);
    ok("otfw dev server ready");

    // The worker/asset refs live in the page's route chunk (base64url of its path).
    const routeUrl = `/__route/${Buffer.from(PAGE).toString("base64url")}.js`;
    const routeCode = await (await fetch(base + routeUrl)).text();

    const workerMatch = routeCode.match(/\/__worker\/[A-Za-z0-9_-]+\.js/);
    const assetMatch = routeCode.match(/\/__asset\/[A-Za-z0-9_-]+\.wasm/);
    assert(!!workerMatch, "route chunk rewrites the worker to a /__worker/ URL");
    assert(!!assetMatch, "route chunk rewrites the asset to a /__asset/ URL");
    assert(!routeCode.includes('"./counter-worker.js"'), "route chunk drops the raw ./counter-worker.js literal");

    // The worker URL serves a real, self-contained bundle that itself rewrites its
    // nested worker to another /__worker/ URL.
    const workerRes = await fetch(base + workerMatch[0]);
    assert(workerRes.ok, "GET /__worker/<counter> is 200 (not a 404)");
    assert((workerRes.headers.get("content-type") || "").includes("javascript"), "worker served as JavaScript");
    const workerCode = await workerRes.text();
    const nestedMatch = workerCode.match(/\/__worker\/[A-Za-z0-9_-]+\.js/);
    assert(!!nestedMatch, "worker bundle rewrites its nested worker to a /__worker/ URL");

    // The worker also rewrites its own `new URL(".wasm")` asset to a /__asset/ URL,
    // which serves the bytes — proving the worker bundle is re-scanned for assets.
    const workerAssetMatch = workerCode.match(/\/__asset\/[A-Za-z0-9_-]+\.wasm/);
    assert(!!workerAssetMatch, "worker bundle rewrites its own asset to a /__asset/ URL");
    const workerAssetRes = await fetch(base + workerAssetMatch[0]);
    assert(workerAssetRes.ok, "GET /__asset/<kernel>.wasm (from inside worker) is 200");
    assert(workerAssetRes.headers.get("content-type") === "application/wasm", "worker-scoped wasm served as application/wasm");

    const nestedRes = await fetch(base + nestedMatch[0]);
    assert(nestedRes.ok, "GET /__worker/<nested> is 200");
    assert((await nestedRes.text()).includes("MARKER_NESTED_WORKER"), "nested worker bundle carries the real source");

    // The asset URL serves the .wasm bytes with the WebAssembly MIME type.
    const assetRes = await fetch(base + assetMatch[0]);
    assert(assetRes.ok, "GET /__asset/<pixel>.wasm is 200");
    assert(assetRes.headers.get("content-type") === "application/wasm", "wasm served as application/wasm");
    const bytes = new Uint8Array(await assetRes.arrayBuffer());
    assert(bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d, "wasm magic header intact");

    // A crafted path outside the project root is refused.
    const escape = `/__asset/${Buffer.from("/etc/passwd").toString("base64url")}.txt`;
    assert((await fetch(base + escape)).status === 404, "/__asset traversal outside root is refused");
  } finally {
    proc.kill();
    await proc.exited;
  }
}

async function main() {
  cleanFixture();
  try {
    await testBuild("csr");
    await testBuild("ssg");
    await testDev();
    console.log(`\n  ${passed} assertions passed\n`);
  } finally {
    cleanFixture();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
