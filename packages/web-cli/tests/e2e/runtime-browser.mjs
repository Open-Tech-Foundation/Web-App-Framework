// Hi-fi runtime unit suite, run in a REAL headless browser.
//
// The runtime tests that probe engine-fidelity paths — custom-element upgrade timing, the real
// microtask/event loop, portal relocation, event delegation — live as `packages/web/runtime/
// *.browser.js` (moved out of the `bun test` glob). This orchestrator bundles them for the
// browser (Bun.build, target=browser), loads the bundle into headless Chromium, and calls the
// in-page runner's `window.__run()`, marshaling the results back over CDP. Everything else
// stays fast under `bun test` + happy-dom.
//
//   bun packages/web-cli/tests/e2e/runtime-browser.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium (CHROME_BIN
// overrides; skips cleanly if absent). Exits 0 only if every test passed.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";
const ENTRY = HERE + "runtime-browser.entry.js";
const PORT = 9355;

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping runtime-browser suite — no Chromium at ${CHROME} (set CHROME_BIN)`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bundle the entry (+ all *.browser.js tests + runtime + runner) for the browser as a single
// IIFE so it evaluates as a classic script over CDP (no top-level import/export to choke on).
async function bundle() {
  const out = await Bun.build({ entrypoints: [ENTRY], target: "browser", format: "iife" });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    throw new Error("Bun.build failed for the runtime-browser bundle");
  }
  return await out.outputs[0].text();
}

async function fetchJSON(url) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out fetching ${url}`);
}

// Minimal CDP client (page-target WebSocket), mirroring the other e2e suites.
async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d?.exception?.description || d?.text || "exception");
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const m = ++id;
      pending.set(m, { res, rej });
      ws.send(JSON.stringify({ id: m, method, params }));
    });
  return { send, pageErrors, close: () => ws.close() };
}

async function evalJS(client, expression, awaitPromise = false) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

async function main() {
  const code = await bundle();
  const chrome = Bun.spawn(
    [CHROME, "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const client = await connectPage(PORT);
    await client.send("Runtime.enable");
    // Load the whole suite (runtime + tests + runner) into the page, then run it.
    await evalJS(client, code);
    const results = await evalJS(client, "window.__run()", true);

    let passed = 0;
    const failures = [];
    for (const r of results) {
      if (r.pass) {
        passed++;
      } else {
        failures.push(r);
      }
    }
    for (const f of failures) {
      console.error(`  ✗ ${f.name}\n      ${f.error}`);
    }
    if (client.pageErrors.length) {
      console.error(`  page exceptions:\n    ${client.pageErrors.slice(0, 5).join("\n    ")}`);
    }
    client.close();

    if (failures.length || !results.length) {
      throw new Error(`runtime-browser: ${failures.length} failed / ${results.length} run`);
    }
    console.log(`\n✅ runtime-browser suite — ${passed} tests passed in a real browser\n`);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e?.message ?? e}\n`);
  process.exit(1);
});
