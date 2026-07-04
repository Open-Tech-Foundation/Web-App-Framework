#!/usr/bin/env bun
// Dependency-free benchmark runner.
//
// Builds one or more benchmark cases with their own toolchain, serves each
// dist/, drives a headless Chrome/Chromium over the DevTools Protocol (no
// Playwright / Puppeteer dependency), collects the in-page results, writes JSON
// under benchmarks/results/, and prints a Markdown table. With more than one
// case it also prints a side-by-side comparison.
//
//   bun run bench                 # case "otfw"
//   bun run bench react           # a single sibling case
//   bun run bench otfw react      # several cases + comparison table
//   bun run bench all             # every case directory, compared
//   bun run bench -- --headful    # show the browser window
//   bun run bench -- --no-build   # reuse existing dist/ (skip the compile step)
//   bun run bench -- --throttle=1 # disable CPU throttling (default 4×)
//
// The page is loaded only after the CDP session applies CPU throttling
// (Emulation.setCPUThrottlingRate, 4× by default, as in js-framework-benchmark):
// throttling stretches sub-frame operations across several frames so the
// double-rAF timer can resolve differences the ~16.7 ms frame floor would hide.
//
// In-page contract (see benchmarks/README.md):
//   window.__BENCH_RESULTS__ = { engine, ua, cases: [{ label, median, runs, samples }] }
//   window.__BENCH_DONE__    = true

import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positionals = args.filter((a) => !a.startsWith("--"));
const headful = flags.has("--headful");
const noBuild = flags.has("--no-build");
const throttleArg = args.find((a) => a.startsWith("--throttle="));
const throttle = throttleArg ? Math.max(1, Number(throttleArg.split("=")[1]) || 1) : 4;

// Double-rAF timing quantizes to frame boundaries, so medians closer than half
// a frame are indistinguishable — the comparison table only declares a winner
// beyond this margin.
const FRAME_MS = 1000 / 60;
const RESOLUTION_MS = FRAME_MS / 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// Declared before the driver loop below: with top-level `await`, the loop
// suspends before any `const` declared lower in the module initializes (TDZ).
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain", ".map": "application/json",
  ".woff2": "font/woff2",
};

// Resolve the list of cases to run.
let cases;
if (positionals.length === 0) cases = ["otfw"];
else if (positionals.length === 1 && positionals[0] === "all") cases = discoverCases();
else cases = positionals;

for (const c of cases) {
  if (!existsSync(join(HERE, c, "package.json"))) die(`no benchmark case "${c}" (looked in ${join(HERE, c)})`);
}

const chromeBin =
  Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chromium-browser");
if (!chromeBin) die("no Chrome/Chromium found (tried google-chrome, chromium, chromium-browser)");

const collected = [];
for (const c of cases) {
  try {
    const result = await runCase(c);
    collected.push(result);
    reportOne(result);
  } catch (err) {
    console.error(`✗ [${c}] ${err.message}`);
  }
}

if (collected.length === 0) process.exit(1);
if (collected.length > 1) reportComparison(collected);
process.exit(0);

// --- per-case orchestration -------------------------------------------------

async function runCase(caseName) {
  const appDir = join(HERE, caseName);

  if (!noBuild) {
    console.log(`\n• [${caseName}] building …`);
    const b = Bun.spawnSync(["bun", "run", "build"], {
      cwd: appDir, stdout: "inherit", stderr: "inherit",
    });
    if (!b.success) throw new Error("build failed");
  }
  const dist = join(appDir, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error(`no dist/index.html in ${dist}`);

  const server = serveStatic(dist);
  const appUrl = `http://127.0.0.1:${server.port}/?autorun`;
  console.log(`• [${caseName}] serving → ${appUrl}`);

  const cdpPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "otfw-bench-"));
  // Opens on about:blank; driveAndCollect navigates to the app only after CPU
  // throttling is applied, so no timed sample runs unthrottled. Fixed window
  // size + scale factor keep the layout area identical across runs; --expose-gc
  // lets the in-page harness collect garbage between samples.
  const chrome = Bun.spawn(
    [
      chromeBin,
      ...(headful ? [] : ["--headless=new"]),
      "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
      "--window-size=1280,800", "--force-device-scale-factor=1",
      "--js-flags=--expose-gc",
      `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  console.log(`• [${caseName}] running suite (${throttle}× CPU throttle) …`);

  try {
    return await driveAndCollect(cdpPort, appUrl);
  } finally {
    chrome.kill();
    server.stop(true);
  }
}

// --- static server ----------------------------------------------------------

function serveStatic(dist) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      let path = new URL(req.url).pathname;
      if (path === "/") path = "/index.html";
      let file = join(dist, path);
      if (!existsSync(file)) file = join(dist, "index.html"); // SPA fallback
      return new Response(Bun.file(file), {
        headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" },
      });
    },
  });
}

// --- CDP driver -------------------------------------------------------------

async function driveAndCollect(port, appUrl) {
  const target = await waitForPageTarget(port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("CDP websocket failed to open"));
  });

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => {
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => pending.set(id, r));
  };
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(`page error: ${r.result.exceptionDetails.text}`);
    }
    return r.result?.result?.value;
  };

  await send("Runtime.enable");
  // Throttle before the page exists so even the first warm-up runs throttled.
  await send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await send("Page.navigate", { url: appUrl });

  // Generous ceiling: 12-sample cases under 4× throttling take a while.
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await evaluate("window.__BENCH_DONE__ === true")) {
      const json = await evaluate("JSON.stringify(window.__BENCH_RESULTS__)");
      ws.close();
      if (!json) throw new Error("suite finished but __BENCH_RESULTS__ was empty");
      return { ...JSON.parse(json), throttle };
    }
    await sleep(250);
  }
  ws.close();
  throw new Error("timed out waiting for the in-page suite to finish (300s)");
}

async function waitForPageTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* devtools endpoint not up yet */
    }
    await sleep(150);
  }
  throw new Error("Chrome DevTools endpoint never became ready");
}

// --- reporting --------------------------------------------------------------

function reportOne(results) {
  const rows = results.cases ?? [];
  const spread = (c) =>
    c.samples?.length
      ? `${Math.min(...c.samples).toFixed(1)}–${Math.max(...c.samples).toFixed(1)}`
      : "—";
  const labelW = Math.max(9, ...rows.map((c) => c.label.length));
  const spreadW = Math.max(12, ...rows.map((c) => spread(c).length));
  const head = `| ${"operation".padEnd(labelW)} | median (ms) | ${"min–max (ms)".padEnd(spreadW)} | samples |`;
  const sep = `| ${"-".repeat(labelW)} | ----------: | ${"-".repeat(spreadW - 1)}: | ------: |`;
  const body = rows
    .map((c) =>
      `| ${c.label.padEnd(labelW)} | ${String(c.median).padStart(11)} | ${spread(c).padStart(spreadW)} | ${String(c.runs).padStart(7)} |`)
    .join("\n");

  console.log(`\nengine: ${results.engine} (CPU throttle ${results.throttle ?? 1}×)`);
  console.log(`${results.ua}`);
  console.log([head, sep, body].join("\n"));

  const outDir = join(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(outDir, `${results.engine}-${stamp}.json`);
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`→ ${out}`);
}

function reportComparison(all) {
  const engines = all.map((r) => r.engine);
  const labels = all[0].cases.map((c) => c.label);
  const lookup = (r, label) => r.cases.find((c) => c.label === label)?.median ?? null;

  const labelW = Math.max(9, ...labels.map((l) => l.length));
  const colW = engines.map((e) => Math.max(11, e.length));
  const fmt = (v) => (v == null ? "—" : String(v));

  const header = `| ${"operation".padEnd(labelW)} | ${engines.map((e, i) => e.padStart(colW[i])).join(" | ")} | fastest |`;
  const sep = `| ${"-".repeat(labelW)} | ${colW.map((w) => "-".repeat(w - 1) + ":").join(" | ")} | :------ |`;
  const body = labels
    .map((label) => {
      const vals = all.map((r) => lookup(r, label));
      const present = vals.filter((v) => v != null);
      const best = Math.min(...present);
      // Only call a winner when the runner-up is more than the timing
      // resolution behind; anything closer is a tie the frame clock can't split.
      const runnerUp = Math.min(...present.filter((v) => v > best), Infinity);
      const decisive = present.length > 1 && runnerUp - best > RESOLUTION_MS;
      const winner = decisive ? engines[vals.findIndex((v) => v === best)] : "~ tie";
      const cells = vals
        .map((v, i) => (decisive && v === best ? `**${fmt(v)}**` : fmt(v)).padStart(colW[i]))
        .join(" | ");
      return `| ${label.padEnd(labelW)} | ${cells} | ${winner.padEnd(7)} |`;
    })
    .join("\n");

  console.log(`\n## Comparison (median ms, lower is better — bold = fastest)\n`);
  console.log([header, sep, body].join("\n"));
  console.log(
    `\n> Same harness, same machine, ${all[0]?.throttle ?? 1}× CPU throttle, double-rAF` +
      ` timing (resolution ≈ ${RESOLUTION_MS.toFixed(1)} ms — margins below that are` +
      ` reported as "~ tie"). Indicative, not a publishable head-to-head until` +
      ` tracing-based timing lands (see README).`,
  );

  const outDir = join(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(outDir, `comparison-${stamp}.json`);
  writeFileSync(out, JSON.stringify({ engines, results: all }, null, 2));
  console.log(`\n→ ${out}`);
}

// --- misc -------------------------------------------------------------------

function discoverCases() {
  return readdirSync(HERE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "results" && existsSync(join(HERE, d.name, "package.json")))
    .map((d) => d.name)
    .sort();
}

async function freePort() {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const p = s.port;
  s.stop(true);
  return p;
}
