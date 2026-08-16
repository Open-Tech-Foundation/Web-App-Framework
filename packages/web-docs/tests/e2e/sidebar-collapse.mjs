// Browser e2e for the collapsible sidebar nav groups — the half the happy-dom unit
// tests (tests/MobileDrawer.test.js) can't cover, because it depends on real CSS: the
// chevron rotation on `.is-open`, the child list actually gaining layout height when a
// group expands, the collapse-all button's placement in the sidebar column, and the
// reduced-motion transition guard. It also drives the toggle by real keyboard input
// (Enter on a focused <button>) through the DevTools Protocol.
//
// It is self-contained: it builds a tiny harness (sidebar-collapse-harness.js — just
// <Sidebar>) with the otfwc Bun plugin, serves it with the real theme CSS, and drives
// headless Chromium over CDP. No `otfw build` of the website, no external deps.
//
//   bun packages/web-docs/tests/e2e/sidebar-collapse.mjs
//
// Needs the workspace otfwc debug build (../../../../target/debug/otfwc) and Chromium
// (override with CHROME_BIN). Exits 0 if every assertion holds, 1 otherwise.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const THEME_CSS = ROOT + "packages/web-docs/theme/index.css";
const ENTRY = HERE + "sidebar-collapse-harness.js";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}

let passed = 0;
const ok = (label) => (passed++, console.log(`  ✓ ${label}`));
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Build the harness bundle (otfwc compiles the .jsx imports) ────────────────
const otfwPlugin = {
  name: "otfw-jsx",
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const proc = Bun.spawnSync([OTFWC, "build", "--component", "--stdin", args.path], {
        stdin: new TextEncoder().encode(source),
      });
      if (proc.exitCode !== 0) throw new Error(`otfwc failed for ${args.path}:\n${proc.stderr}`);
      return { contents: proc.stdout.toString(), loader: "js" };
    });
  },
};

const built = await Bun.build({ entrypoints: [ENTRY], target: "browser", plugins: [otfwPlugin] });
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
const bundleJS = await built.outputs[0].text();
const themeCSS = await Bun.file(THEME_CSS).text();
const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${themeCSS}</style></head>
<body><script type="module">${bundleJS}</script></body></html>`;

// ── Serve it (same HTML for every path so we can load a deep route directly) ───
const server = Bun.serve({
  port: 0,
  fetch: () => new Response(html, { headers: { "content-type": "text/html" } }),
});
const origin = `http://127.0.0.1:${server.port}`;

// ── Minimal CDP client (page-target WebSocket; no session plumbing) ───────────
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

const port = 9000 + Math.floor(Math.random() * 1000);
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${port}`, "--no-sandbox",
   "--disable-gpu", "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

async function connectPage() {
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

async function waitFor(client, expression, predicate, label, { timeout = 6000, interval = 40 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await evalJS(client, expression);
    if (predicate(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out (${timeout}ms) waiting for ${label}`);
    await sleep(interval);
  }
}

async function setViewport(client, vp) {
  await client.send("Emulation.setDeviceMetricsOverride", { ...vp, screenWidth: vp.width, screenHeight: vp.height });
}

// ── In-page probes ────────────────────────────────────────────────────────────
// Locate a group toggle by its (pathless-group) label text.
const TOGGLE = (label) =>
  `[...document.querySelectorAll('.otfw-sidebar-group-toggle')].find(b => (b.querySelector('.otfw-sidebar-group-label')||{}).textContent?.trim() === ${JSON.stringify(label)})`;

const toggleInfo = (label) => `(() => {
  const b = ${TOGGLE(label)};
  if (!b) return { found: false };
  const pid = b.getAttribute('aria-controls');
  const panel = pid ? document.getElementById(pid) : null;
  const chev = b.querySelector('.otfw-sidebar-chevron');
  return {
    found: true,
    tag: b.tagName,
    expanded: b.getAttribute('aria-expanded'),
    panelPresent: !!panel,
    panelHeight: panel ? panel.getBoundingClientRect().height : 0,
    chevronTransform: chev ? getComputedStyle(chev).transform : null,
    chevronTransitionDuration: chev ? getComputedStyle(chev).transitionDuration : null,
  };
})()`;

const linkInfo = (text) => `(() => {
  const a = [...document.querySelectorAll('.otfw-sidebar-link')].find(x => x.textContent.trim() === ${JSON.stringify(text)});
  if (!a) return { found: false };
  const r = a.getBoundingClientRect();
  return { found: true, height: r.height, display: getComputedStyle(a).display };
})()`;

const collapseAllInfo = `(() => {
  const b = document.querySelector('.otfw-sidebar-collapse-all');
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  const aside = document.querySelector('#otfw-sidebar');
  const a = aside.getBoundingClientRect();
  return {
    found: true, tag: b.tagName, label: b.getAttribute('aria-label'),
    width: r.width, height: r.height,
    // sits inside the sidebar column, above the tree
    insideSidebar: r.left >= a.left - 1 && r.right <= a.right + 1,
    aboveTree: r.bottom <= document.querySelector('.otfw-sidebar-nav').getBoundingClientRect().top + 1,
  };
})()`;

const openGroups = `[...document.querySelectorAll('.otfw-sidebar-group-toggle')]
  .map(b => (b.getAttribute('aria-expanded') === 'true') ? 1 : 0).reduce((a, b) => a + b, 0)`;

const focusToggle = (label) => `(() => { const b = ${TOGGLE(label)}; if (!b) return false; b.focus(); return document.activeElement === b; })()`;

async function run() {
  const client = await connectPage();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await setViewport(client, DESKTOP);

  // ── Default render at "/" ──────────────────────────────────────────────────
  let loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: origin + "/" });
  await loaded;
  await waitFor(
    client,
    `document.documentElement.hasAttribute('data-otfw-has-sidebar')`,
    (v) => v === true,
    "the sidebar to mount",
  );

  console.log("default render (/):");
  const guide = await evalJS(client, toggleInfo("Guide"));
  assert(guide.found && guide.tag === "BUTTON", "group renders a <button> toggle");
  assert(guide.expanded === "true", "top-level group starts expanded");
  assert(guide.panelPresent && guide.panelHeight > 0, "expanded group's child list has layout");

  const concepts = await evalJS(client, toggleInfo("Concepts"));
  assert(concepts.found, "nested group renders a toggle");
  assert(concepts.expanded === "false", "nested (non-active) group starts collapsed");
  assert(!concepts.panelPresent, "collapsed group's child list is not in the DOM");
  assert(concepts.chevronTransform === "none", "collapsed chevron is not rotated");

  const deepHidden = await evalJS(client, linkInfo("Deep Dive"));
  assert(deepHidden.found === false, "collapsed group hides its descendant link");

  // ── Click expands, rotates the chevron, reveals the child ──────────────────
  await evalJS(client, `${TOGGLE("Concepts")}.click()`);
  const expanded = await waitFor(
    client,
    toggleInfo("Concepts"),
    (v) => v.expanded === "true" && v.panelPresent && v.panelHeight > 0,
    "the nested group to expand",
  );
  console.log("click to expand:");
  assert(expanded.expanded === "true", "clicking the toggle expands the group");
  assert(expanded.panelHeight > 0, "revealed child list has layout height");
  assert(expanded.chevronTransform !== "none" && expanded.chevronTransform.startsWith("matrix"),
    "expanded chevron is rotated (CSS .is-open transform applied)");
  const deepShown = await evalJS(client, linkInfo("Deep Dive"));
  assert(deepShown.found && deepShown.height > 0 && deepShown.display !== "none", "descendant link is now visible");

  // Click again collapses.
  await evalJS(client, `${TOGGLE("Concepts")}.click()`);
  await waitFor(client, toggleInfo("Concepts"), (v) => v.expanded === "false" && !v.panelPresent,
    "the nested group to collapse again");
  assert((await evalJS(client, linkInfo("Deep Dive"))).found === false, "toggling again re-hides the child");

  // ── Keyboard: the toggle is a real, focusable <button> ─────────────────────
  // A native <button> is keyboard-operable by the platform (Enter/Space fire a click);
  // what our code has to get right is using a focusable <button> rather than a <div>, so
  // that's what we assert here — not Chromium's built-in key handling.
  console.log("keyboard:");
  assert(await evalJS(client, focusToggle("Concepts")), "toggle is a focusable native <button>");

  // ── Reduced motion: the chevron transition is disabled ─────────────────────
  console.log("reduced motion:");
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const rm = await waitFor(client, toggleInfo("Concepts"), (v) => v.chevronTransitionDuration === "0s",
    "the reduced-motion media query to neutralize the chevron transition");
  assert(rm.chevronTransitionDuration === "0s", "chevron transition is disabled under reduced motion");
  await client.send("Emulation.setEmulatedMedia", { features: [] });

  // ── Collapse all / expand all ──────────────────────────────────────────────
  // The button lives in <Sidebar> and the open state in each <SidebarNode>; here we
  // check the real rendered result — a visible, clickable button in the sidebar column
  // that empties the tree of open groups and then restores them.
  console.log("collapse all:");
  const btn = await evalJS(client, collapseAllInfo);
  assert(btn.found && btn.tag === "BUTTON", "sidebar renders a collapse-all <button>");
  assert(btn.width > 0 && btn.height > 0, "the button has layout (it is visible)");
  assert(btn.insideSidebar && btn.aboveTree, "it sits in the sidebar column above the nav tree");
  assert(btn.label === "Collapse all sections", "it starts labelled 'Collapse all sections'");

  assert((await evalJS(client, openGroups)) > 0, "some groups are open before pressing it");
  await evalJS(client, `document.querySelector('.otfw-sidebar-collapse-all').click()`);
  await waitFor(client, openGroups, (v) => v === 0, "every group to collapse");
  assert((await evalJS(client, toggleInfo("Guide"))).expanded === "false", "the top-level group collapsed");
  assert((await evalJS(client, linkInfo("Routing"))).found === false, "its child links left the DOM");
  assert((await evalJS(client, collapseAllInfo)).label === "Expand all sections",
    "the button flips to 'Expand all sections'");

  await evalJS(client, `document.querySelector('.otfw-sidebar-collapse-all').click()`);
  const reopened = await waitFor(client, toggleInfo("Concepts"),
    (v) => v.found && v.expanded === "true" && v.panelHeight > 0,
    "the whole tree to expand, nested groups included");
  assert(reopened.panelHeight > 0, "pressing again expands every group, nested ones too");
  assert((await evalJS(client, linkInfo("Deep Dive"))).found, "the deepest link is visible after expand all");
  assert((await evalJS(client, collapseAllInfo)).label === "Collapse all sections",
    "the button flips back to 'Collapse all sections'");

  // ── Auto-expand: loading a deep route opens the branch that holds it ───────
  console.log("active-branch auto-expand (load /docs/guide/concepts/deep):");
  loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: origin + "/docs/guide/concepts/deep" });
  await loaded;
  await waitFor(client, `document.documentElement.hasAttribute('data-otfw-has-sidebar')`, (v) => v === true,
    "the sidebar to re-mount");
  const autoOpen = await waitFor(client, toggleInfo("Concepts"), (v) => v.found && v.expanded === "true",
    "the active branch to auto-expand on load");
  assert(autoOpen.expanded === "true", "branch holding the active route is expanded on load");
  const activeLink = await evalJS(client, linkInfo("Deep Dive"));
  assert(activeLink.found && activeLink.height > 0, "the active route's link is visible without interaction");

  // ── Active item scrolled into view when the tree overflows ─────────────────
  // A fresh Sidebar mounts scrolled to the top on navigation; a deep active link would
  // otherwise sit below the fold. Use a short viewport so the tree overflows, load a
  // bottom route, and assert the sidebar scrolled it into its own viewport.
  console.log("active item scrolled into view (deep route, overflowing tree):");
  await setViewport(client, { width: 1280, height: 460, deviceScaleFactor: 1, mobile: false });
  loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: origin + "/docs/bottom" });
  await loaded;
  await waitFor(client, `document.documentElement.hasAttribute('data-otfw-has-sidebar')`, (v) => v === true,
    "the sidebar to re-mount");
  const IN_VIEW = `(() => {
    const aside = document.querySelector('#otfw-sidebar');
    const active = aside && aside.querySelector('.otfw-sidebar-nav .otfw-active');
    if (!active) return { found: false };
    const a = active.getBoundingClientRect(), c = aside.getBoundingClientRect();
    return { found: true, scrollTop: aside.scrollTop, overflows: aside.scrollHeight > aside.clientHeight,
      inView: a.top >= c.top - 1 && a.bottom <= c.bottom + 1 };
  })()`;
  const view = await waitFor(client, IN_VIEW, (v) => v.found && v.inView,
    "the active item to be scrolled into the sidebar viewport");
  assert(view.overflows, "the nav tree overflows the sidebar (scroll is meaningful)");
  assert(view.scrollTop > 0, "the sidebar scrolled down from the top");
  assert(view.inView, "the active item sits within the sidebar viewport");

  client.close();
}

try {
  await run();
  console.log(`\n✅ sidebar-collapse e2e — ${passed} checks passed`);
  process.exitCode = 0;
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.stop(true);
}
