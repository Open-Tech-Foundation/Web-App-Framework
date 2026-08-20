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
//   esdev packages/web-cli/tests/e2e/lifecycle-hooks-browser.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build (OTFWC_BIN
// overrides) and Chromium (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if
// every assertion holds.

import { assert, cleanFixture, cli, HERE, OTFWC, run, sleep, stop, waitForReady } from "./lib.js";
import { connectPage, evalJS, requireCompiler, startBrowser } from "./browser.js";

const FIXTURE = `${HERE}/fixture`;
const DEBUG_PORT = 9334;

await requireCompiler(OTFWC);

// Observers and media queries deliver on rendering frames; in headless mode a screenshot is
// the simplest way to pump one so the callbacks (and their signal writes) land.
async function forceFrame(client) {
  await client.send("Page.captureScreenshot", { format: "png" });
}

// Poll an in-page boolean until truthy, pumping a rendering frame each iteration so the
// observer/matchMedia callbacks the assertions depend on actually deliver. Replaces the fixed
// settle sleeps, which flake on a slow CI runner. Throws with `label` on timeout.
async function waitFor(client, expression, label, { timeout = 8000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await forceFrame(client);
    if (await evalJS(client, `!!(${expression})`)) return;
    if (Date.now() > deadline) throw new Error(`timed out (${timeout}ms) waiting for ${label}`);
    await sleep(interval);
  }
}

async function setViewport(client, width) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

const PROBE = `(() => ({
  path: location.pathname,
  mode: document.querySelector('.mq-mode')?.textContent ?? null,
  boxW: document.querySelector('.box-w')?.textContent ?? null,
  boxSeen: document.querySelector('.box-seen')?.textContent ?? null,
  log: [...(window.__hookLog ?? [])],
}))()`;

async function drive(port) {
  const chrome = await startBrowser(DEBUG_PORT);
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
    // Wait for hydration + the observers' initial async entries, not a guessed settle time.
    await waitFor(
      client,
      `document.querySelector('.mq-mode')?.textContent === 'wide' && Number(document.querySelector('.box-w')?.textContent) > 0 && (window.__hookLog ?? []).includes('box-visible:false')`,
      "hydration + initial observer entries (wide mode, box measured, below-fold reported)",
    );

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
    await waitFor(
      client,
      `document.querySelector('.mq-mode')?.textContent === 'compact' && (window.__hookLog ?? []).includes('page-mq:true') && (window.__hookLog ?? []).filter((l) => l.startsWith('page-resize:')).length > 1`,
      "the 600px viewport change to deliver (compact + page-mq:true + a fresh page-resize entry)",
    );
    const s2 = await evalJS(client, PROBE);
    assert(s2.mode === "compact", "crossing the breakpoint flipped onMediaQuery (600px → compact)");
    assert(s2.log.includes("page-mq:true"), "the matchMedia change event reached the callback");
    const resizes = s2.log.filter((l) => l.startsWith("page-resize:"));
    assert(resizes.length > 1, "the viewport change delivered a fresh page ResizeObserver entry");
    const lastBox = [...s2.log].reverse().find((l) => l.startsWith("box-resize:"));
    assert(Number(lastBox.split(":")[1]) < Number(boxResize.split(":")[1]), "the component's host re-measured smaller at the narrower viewport");

    await evalJS(client, "window.scrollTo(0, document.body.scrollHeight)");
    await waitFor(
      client,
      `(window.__hookLog ?? []).includes('box-visible:true')`,
      "scrolling the probe into view to fire onVisibilityChange(true)",
    );
    const s3 = await evalJS(client, PROBE);
    assert(s3.log.includes("box-visible:true"), "scrolling the probe into view fired onVisibilityChange(true)");
    assert(s3.boxSeen === "yes", "the visibility callback drove the component's $state into the DOM");

    // ── 3. SPA navigation away tears everything down ────────────────────────────
    const marker = s3.log.length;
    await evalJS(client, `history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    await waitFor(
      client,
      `location.pathname === '/' && document.querySelector('.mq-mode') === null`,
      "the SPA navigation away from /hooks to commit (page + probe left the DOM)",
    );
    const nav = await evalJS(client, PROBE);
    assert(nav.path === "/", "the client router navigated away from /hooks");
    assert(nav.mode === null && nav.boxSeen === null, "the hooks page (and the probe island) left the DOM");

    await setViewport(client, 900);
    await setViewport(client, 500);
    await evalJS(client, "window.scrollTo(0, document.body.scrollHeight); window.scrollTo(0, 0)");
    // Negative check: there's no condition to poll *for* — we assert absence. Pump several
    // frames (the only thing that would deliver a stray observer entry if one were still
    // connected), which is deterministic, then confirm the log never grew.
    for (let i = 0; i < 6; i++) await forceFrame(client);
    const s4 = await evalJS(client, PROBE);
    assert(
      s4.log.length === marker,
      `no callback fired after navigation — observers disconnected, matchMedia listener removed (log stayed at ${marker})`,
    );

    // ── 4. Navigating back rewires fresh hooks ──────────────────────────────────
    await evalJS(client, `history.pushState({}, '', '/hooks'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    await waitFor(
      client,
      `location.pathname === '/hooks' && document.querySelector('.mq-mode')?.textContent === 'compact' && (window.__hookLog ?? []).length > ${marker}`,
      "navigating back to /hooks to remount (fresh compact media state + fresh hook callbacks)",
    );
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
  await cleanFixture(FIXTURE);
  const proc = await cli(["serve"], { root: FIXTURE });
  try {
    await drive(await waitForReady(proc));
  } finally {
    await stop(proc);
    await cleanFixture(FIXTURE);
  }
}

await run("lifecycle-hooks e2e", main);
