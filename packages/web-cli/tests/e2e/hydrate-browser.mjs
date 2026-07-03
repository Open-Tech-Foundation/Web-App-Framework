// Real-browser hydration e2e — the §5 verification bar of docs/HYDRATION.md, the
// thing happy-dom unit tests can't prove: that a real browser *adopts* the
// server-rendered DOM on first paint instead of rebuilding it.
//
// It drives the actual `otfw serve` (SSR + hydrate client bundle + the
// data-otfw-hydrate sentinel) against the same fixture the serve e2e uses, and
// asserts the two properties that define correct hydration:
//
//   1. No re-creation on hydrate — every server-rendered node under #app keeps its
//      identity through hydration (nothing is torn out and rebuilt). Proven by a
//      document-start MutationObserver that tags each server node as the parser
//      inserts it, then checks the live nodes still carry the tag and that zero
//      tagged nodes were removed.
//   2. Server state preserved + interactivity — the counter shows its server value
//      after hydrate and increments on click, on the very same (adopted) text node,
//      with no reset/flash.
//
//   bun packages/web-cli/tests/e2e/hydrate-browser.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium
// (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if every assertion holds.

import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI = ROOT + "packages/web-cli/src/cli.js";
const FIXTURE = HERE + "fixture";
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping hydrate-browser e2e — no Chromium at ${CHROME} (set CHROME_BIN)`);
  process.exit(0);
}

let passed = 0;
const ok = (label) => (passed++, console.log(`  ✓ ${label}`));
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanFixture() {
  for (const d of ["dist", ".otfw", ".otfw-ssg", ".dev"]) {
    rmSync(`${FIXTURE}/${d}`, { recursive: true, force: true });
  }
}

// Read the server's stdout until the "ready" line appears; return the bound port.
async function waitForReady(proc, timeoutMs = 60000) {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk);
    const m = buf.match(/http:\/\/localhost:(\d+)/);
    if (m && /ready in/.test(buf)) return Number(m[1]);
    if (Date.now() > deadline) break;
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms:\n${buf}`);
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

// Minimal CDP client (page-target WebSocket), mirroring web-docs/tests/e2e.
async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
        console.error("  [page error]", msg.params.args.map((a) => a.value || a.description).join(" "));
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) waiters.splice(i, 1)[0].res(msg.params);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const m = ++id;
      pending.set(m, { res, rej });
      ws.send(JSON.stringify({ id: m, method, params }));
    });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once, close: () => ws.close() };
}

async function evalJS(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.text} in ${expression}`);
  return r.result.value;
}

// Installed at document-start (before any page script and before the body parses):
// tag every server node as the parser inserts it, and count any tagged node that is
// later removed. A CSR rebuild would replaceChildren() — tearing the tagged subtree
// out — so a non-zero removal count (or a live node missing its tag) proves a rebuild.
const OBSERVER = `
  window.__removedServer = 0;
  const tag = (n) => {
    if (n.nodeType === 1 || n.nodeType === 3) n.__server = true;
    if (n.querySelectorAll) for (const d of n.querySelectorAll('*')) d.__server = true;
  };
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of rec.addedNodes) tag(n);
      for (const n of rec.removedNodes) if (n.__server) window.__removedServer++;
    }
  });
  // Observe the document node itself: at document-start documentElement may not yet
  // exist, but observing the document with subtree:true catches the whole tree as the
  // parser builds it (documentElement, head, body, and every #app descendant).
  mo.observe(document, { childList: true, subtree: true });
  if (document.documentElement) tag(document.documentElement);
`;

// Read after hydration: identity of the live nodes + the rendered counts. The page
// has an inline counter (a page-factory hydration) AND a <Stepper> component island (a
// custom-element self-adoption) — both must adopt, not rebuild.
const PROBE = `(() => {
  const main = document.querySelector('#app main');
  const incBtn = document.querySelector('#app main > button');     // the page's own counter
  const p = document.querySelector('#app p');
  const stepperHost = document.querySelector('#app .web-stepper');  // the component host
  const stepperBtn = document.querySelector('#app .stepper');       // its inner button
  const norm = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  return {
    hasSentinel: document.querySelector('#app')?.hasAttribute('data-otfw-hydrate') ?? false,
    mainIsServer: !!(main && main.__server),
    incIsServer: !!(incBtn && incBtn.__server),
    removedServer: window.__removedServer,
    countText: norm(p),
    buttonCount: document.querySelectorAll('#app button').length,
    // component island
    stepperHostIsServer: !!(stepperHost && stepperHost.__server),
    stepperBtnIsServer: !!(stepperBtn && stepperBtn.__server),
    stepperText: norm(stepperBtn),
    // compiler-driven data hydration: the rich object prop crosses via the payload,
    // keyed by the host's data-h id, not as a stringified config attribute.
    stepperHasDataH: !!(stepperHost && stepperHost.hasAttribute('data-h')),
    stepperHasConfigAttr: !!(stepperHost && stepperHost.hasAttribute('config')),
    payloadConfig: (() => {
      const s = document.getElementById('__otfw_h');
      if (!s) return null;
      try { const p = JSON.parse(s.textContent); return p[+stepperHost.getAttribute('data-h')].config; }
      catch { return 'PARSE_ERROR'; }
    })(),
  };
})()`;

async function run(port) {
  const chrome = Bun.spawn(
    [CHROME, "--headless=new", `--remote-debugging-port=9333`, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const client = await connectPage(9333);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    // Tag server nodes before the page's client bundle runs.
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });

    const loaded = client.once("Page.loadEventFired");
    // 127.0.0.1, not `localhost` — the latter can resolve to IPv6 (::1) and hit an
    // unrelated dev server on the same port on the other stack (`otfw serve` binds IPv4).
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await loaded;
    // Deferred module scripts have executed by load; let the hydrate microtask settle.
    await sleep(200);

    // ── 1. Adoption — the server DOM was claimed, not rebuilt ───────────────────
    const s = await evalJS(client, PROBE);
    assert(s.hasSentinel, "#app carries the data-otfw-hydrate sentinel (SSR shell)");
    assert(s.buttonCount === 2, "two <button>s (page counter + component) — nothing duplicated");
    assert(s.removedServer === 0, "no server-rendered node was removed (no CSR rebuild)");
    assert(s.mainIsServer, "the live <main> is the server-rendered node (adopted)");
    assert(s.incIsServer, "the page's counter <button> is the server-rendered node (adopted)");
    assert(s.countText === "count 0", "the server-rendered count is preserved through hydrate");

    // ── 1b. The component island self-adopted (custom element) ──────────────────
    assert(s.stepperHostIsServer, "the <web-stepper> host is the server-rendered node (adopted)");
    assert(s.stepperBtnIsServer, "the component's inner <button> is server-rendered (adopted)");
    // Compiler-driven data hydration: the rich `config` object crossed via the serialized
    // payload (keyed by the host's data-h id), NOT as a stringified attribute — and the
    // component's constructor read it at upgrade. "Steps n=7" proves `config.label` arrived
    // on the adopted node with the internal `$state(7)` intact (no blank, no flash).
    assert(s.stepperHasDataH, "the island host carries a data-h hydration id");
    assert(!s.stepperHasConfigAttr, "the rich prop is NOT a stringified `config=` attribute");
    assert(
      s.payloadConfig && s.payloadConfig.label === "Steps",
      "the payload carries the rich object prop (config.label)",
    );
    assert(s.stepperText === "Steps n=7", "the constructor read the object prop at upgrade (config.label + $state 7)");

    // ── 2. Interactivity is live on both adopted islands ────────────────────────
    await evalJS(client, `document.querySelector('#app main > button').click()`);
    await evalJS(client, `document.querySelector('#app .stepper').click()`);
    await sleep(50);
    const after = await evalJS(client, PROBE);
    assert(after.countText === "count 1", "clicking the page button increments its signal");
    assert(after.incIsServer, "the page button is still the same adopted node after the update");
    assert(after.stepperText === "Steps n=8", "clicking the component button increments its own signal (prop intact)");
    assert(after.stepperBtnIsServer, "the component button is still the same adopted node");
    assert(after.removedServer === 0, "reactivity updated in place — still no server node removed");

    client.close();
  } finally {
    chrome.kill();
  }
}

async function main() {
  cleanFixture();
  const proc = Bun.spawn(["bun", CLI, "serve"], {
    cwd: FIXTURE,
    env: { ...process.env, OTFWC_BIN: OTFWC },
    stdout: "pipe",
    stderr: "inherit",
  });
  try {
    const port = await waitForReady(proc);
    await run(port);
    console.log(`\n✅ hydrate-browser e2e — ${passed} checks passed\n`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
    cleanFixture();
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e?.message ?? e}\n`);
  process.exit(1);
});
