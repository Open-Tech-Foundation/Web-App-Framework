// Real-browser e2e for the DOM lifecycle hooks (`onResize` / `onVisibilityChange` /
// `onMediaQuery`) — the platform behaviors happy-dom cannot exercise: an actual
// ResizeObserver measuring real layout, an IntersectionObserver fed by real scrolling,
// and matchMedia responding to a real viewport change. Drives `otfw serve` (SSR +
// hydrate bundle) against the shared fixture's /hooks route, which mounts page-level
// hooks plus a <HookProbe> component island, both logging into `window.__hookLog`:
//
//   1. Hydrated mount wires everything — the synchronous initial `onMediaQuery` call
//      renders the current breakpoint, both observers deliver their initial entries
//      (the component's on a real, CSS-sized host), and the below-fold probe reports
//      not-visible.
//   2. Real viewport + scroll changes fire the callbacks — the media query flips at
//      the breakpoint, resize entries track the new widths, scrolling the probe into
//      view flips `onVisibilityChange` and its rendered state.
//   3. SPA navigation away tears everything down — further resizes/scrolls add
//      nothing to the log (observers disconnected, matchMedia listener removed).
//   4. Navigating back rewires fresh hooks with a fresh initial media state.
//
//   bun packages/web-cli/tests/e2e/lifecycle-hooks-browser.mjs
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
const DEBUG_PORT = 9334;

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping lifecycle-hooks e2e — no Chromium at ${CHROME} (set CHROME_BIN)`);
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
  for (const d of ["dist", ".otfw", ".otfw-ssg", ".otfw-loaders", ".otfw-loaders-build", ".dev"]) {
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

// Minimal CDP client (page-target WebSocket), mirroring hydrate-browser.mjs.
async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  const pageErrors = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = msg.params.args.map((a) => a.value || a.description).join(" ");
        pageErrors.push(text);
        console.error("  [page error]", text);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        pageErrors.push(d?.exception?.description || d?.text || "exception");
      }
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
  return { send, once, pageErrors, close: () => ws.close() };
}

async function evalJS(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.text} in ${expression}`);
  return r.result.value;
}

// Observers and media queries deliver on rendering frames; a screenshot forces one
// in headless mode, then a short settle lets the callbacks (and signal writes) land.
async function settleFrame(client, ms = 400) {
  await client.send("Page.captureScreenshot", { format: "png" });
  await sleep(ms);
}

async function setViewport(client, width) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settleFrame(client);
}

const PROBE = `(() => ({
  path: location.pathname,
  mode: document.querySelector('.mq-mode')?.textContent ?? null,
  boxW: document.querySelector('.box-w')?.textContent ?? null,
  boxSeen: document.querySelector('.box-seen')?.textContent ?? null,
  log: [...(window.__hookLog ?? [])],
}))()`;

async function run(port) {
  const chrome = Bun.spawn(
    [CHROME, "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const client = await connectPage(DEBUG_PORT);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1000,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // ── 1. Hydrated mount wires all three hooks ─────────────────────────────────
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/hooks` });
    await loaded;
    await settleFrame(client, 500); // hydration + the observers' initial async entries

    const s1 = await evalJS(client, PROBE);
    assert(s1.mode === "wide", "onMediaQuery delivered the initial state synchronously at mount (1000px → wide)");
    const mountIdx = s1.log.indexOf("mount");
    const mqIdx = s1.log.indexOf("page-mq:false");
    assert(mountIdx !== -1 && mqIdx !== -1 && mountIdx < mqIdx, "onMount ran before the hook closures (FIFO)");
    const pageResize = s1.log.find((l) => l.startsWith("page-resize:"));
    assert(pageResize && Number(pageResize.split(":")[1]) > 0, `a real ResizeObserver entry measured the page root (${pageResize})`);
    const boxResize = s1.log.find((l) => l.startsWith("box-resize:"));
    assert(boxResize && Number(boxResize.split(":")[1]) > 0, `the component host (display:block via its .web-hook-probe hook) measured > 0 (${boxResize})`);
    assert(Number(s1.boxW) > 0, "the component's resize callback drove its $state into the DOM");
    assert(s1.log.includes("box-visible:false"), "the below-fold probe reported not-visible (real IntersectionObserver initial entry)");
    assert(s1.boxSeen === "no", "the probe's rendered state matches (not seen yet)");

    // ── 2. Real viewport + scroll changes fire the callbacks ───────────────────
    await setViewport(client, 600);
    const s2 = await evalJS(client, PROBE);
    assert(s2.mode === "compact", "crossing the breakpoint flipped onMediaQuery (600px → compact)");
    assert(s2.log.includes("page-mq:true"), "the matchMedia change event reached the callback");
    const resizes = s2.log.filter((l) => l.startsWith("page-resize:"));
    assert(resizes.length > 1, "the viewport change delivered a fresh page ResizeObserver entry");
    const lastBox = [...s2.log].reverse().find((l) => l.startsWith("box-resize:"));
    assert(Number(lastBox.split(":")[1]) < Number(boxResize.split(":")[1]), "the component's host re-measured smaller at the narrower viewport");

    await evalJS(client, "window.scrollTo(0, document.body.scrollHeight)");
    await settleFrame(client);
    const s3 = await evalJS(client, PROBE);
    assert(s3.log.includes("box-visible:true"), "scrolling the probe into view fired onVisibilityChange(true)");
    assert(s3.boxSeen === "yes", "the visibility callback drove the component's $state into the DOM");

    // ── 3. SPA navigation away tears everything down ────────────────────────────
    const marker = s3.log.length;
    await evalJS(client, `history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    await sleep(400);
    const nav = await evalJS(client, PROBE);
    assert(nav.path === "/", "the client router navigated away from /hooks");
    assert(nav.mode === null && nav.boxSeen === null, "the hooks page (and the probe island) left the DOM");

    await setViewport(client, 900);
    await setViewport(client, 500);
    await evalJS(client, "window.scrollTo(0, document.body.scrollHeight); window.scrollTo(0, 0)");
    await settleFrame(client);
    const s4 = await evalJS(client, PROBE);
    assert(
      s4.log.length === marker,
      `no callback fired after navigation — observers disconnected, matchMedia listener removed (log stayed at ${marker})`,
    );

    // ── 4. Navigating back rewires fresh hooks ──────────────────────────────────
    await evalJS(client, `history.pushState({}, '', '/hooks'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    await sleep(400);
    await settleFrame(client);
    const s5 = await evalJS(client, PROBE);
    assert(s5.path === "/hooks", "the client router navigated back to /hooks");
    assert(s5.mode === "compact", "the remounted page got a fresh synchronous initial media state (500px → compact)");
    assert(s5.log.length > marker, "fresh hook callbacks fired after the remount");

    const hookErrors = client.pageErrors.filter((e) => /otfw:|TypeError|ReferenceError/.test(e));
    assert(hookErrors.length === 0, `the whole flow ran with a clean console (found ${hookErrors.length})`);

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
    console.log(`\n✅ lifecycle-hooks e2e — ${passed} checks passed\n`);
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
