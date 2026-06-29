// Browser e2e for the mobile sidebar drawer — the half the happy-dom unit tests
// (tests/MobileDrawer.test.js) can't cover, because it depends on real CSS: the
// off-canvas transform, the 768px breakpoint, the slide-in, the backdrop, and the
// body-scroll lock.
//
// It is self-contained: it builds a tiny harness (drawer-harness.js — just <Sidebar> +
// <SidebarToggle>) with the otfwc Bun plugin, serves it with the real theme CSS, and
// drives headless Chromium over the DevTools Protocol. No `otfw build` of the website,
// no external deps — a static Bun.serve + a ~40-line CDP client over a WebSocket.
//
//   bun packages/web-docs/tests/e2e/mobile-drawer.mjs
//
// Needs the workspace otfwc debug build (../../../../target/debug/otfwc) and Chromium
// (override with CHROME_BIN). Exits 0 if every assertion holds, 1 otherwise.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const THEME_CSS = ROOT + "packages/web-docs/theme/index.css";
const ENTRY = HERE + "drawer-harness.js";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";
const MOBILE = { width: 390, height: 800, deviceScaleFactor: 1, mobile: true };
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

// ── Serve it ──────────────────────────────────────────────────────────────────
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

// Geometry/style probe for the three drawer pieces, read in-page.
const PROBE = `(() => {
  const aside = document.querySelector('#otfw-sidebar');
  const backdrop = document.querySelector('.otfw-sidebar-backdrop');
  const burger = document.querySelector('.otfw-navbar-burger');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, width: b.width }; };
  return {
    asideRect: aside ? r(aside) : null,
    asidePosition: aside ? cs(aside).position : null,
    asideVisibility: aside ? cs(aside).visibility : null,
    asideOpen: aside ? aside.classList.contains('is-open') : null,
    backdropDisplay: backdrop ? cs(backdrop).display : null,
    backdropOpacity: backdrop ? cs(backdrop).opacity : null,
    burgerDisplay: burger ? cs(burger).display : null,
    burgerExpanded: burger ? burger.getAttribute('aria-expanded') : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    hasSidebar: document.documentElement.hasAttribute('data-otfw-has-sidebar'),
    linkCount: aside ? aside.querySelectorAll('.otfw-sidebar-link').length : 0,
  };
})()`;

async function setViewport(client, vp) {
  await client.send("Emulation.setDeviceMetricsOverride", { ...vp, screenWidth: vp.width, screenHeight: vp.height });
}

async function run() {
  const client = await connectPage();
  const probe = () => evalJS(client, PROBE);
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  // ── Mobile: drawer behavior ────────────────────────────────────────────────
  await setViewport(client, MOBILE);
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: origin + "/" });
  await loaded;
  // Wait for client JS to mount (the Sidebar flags the root on mount).
  for (let i = 0; i < 50; i++) {
    if ((await probe()).hasSidebar) break;
    await sleep(100);
  }

  console.log("mobile (390px):");
  let s = await probe();
  assert(s.hasSidebar, "sidebar mounted (root flagged)");
  assert(s.linkCount >= 2, "drawer rendered its nav tree");
  assert(s.burgerDisplay && s.burgerDisplay !== "none", "burger is visible on mobile");
  assert(s.asideOpen === false, "drawer starts closed");
  assert(s.asideRect.right <= 1, "drawer is off-canvas to the left");
  assert(s.asideVisibility === "hidden", "drawer is visibility:hidden while closed");
  assert(s.backdropOpacity === "0", "backdrop is hidden");

  // Open via the burger.
  await evalJS(client, `document.querySelector('.otfw-navbar-burger').click()`);
  await sleep(400);
  s = await probe();
  assert(s.asideOpen === true, "burger opens the drawer");
  assert(s.asideRect.left >= -1 && s.asideRect.width > 0, "drawer slid into view");
  assert(s.asideVisibility === "visible", "drawer is visible when open");
  assert(s.backdropOpacity === "1", "backdrop is shown");
  assert(s.bodyOverflow === "hidden", "body scroll is locked");
  assert(s.burgerExpanded === "true", "burger aria-expanded is true");

  // Backdrop click closes and releases the lock.
  await evalJS(client, `document.querySelector('.otfw-sidebar-backdrop').click()`);
  await sleep(400);
  s = await probe();
  assert(s.asideOpen === false, "backdrop click closes the drawer");
  assert(s.bodyOverflow !== "hidden", "scroll lock released after close");
  assert(s.burgerExpanded === "false", "burger aria-expanded back to false");

  // Re-open, then Escape closes.
  await evalJS(client, `document.querySelector('.otfw-navbar-burger').click()`);
  await sleep(300);
  assert((await probe()).asideOpen === true, "burger re-opens the drawer");
  await evalJS(client, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await sleep(400);
  s = await probe();
  assert(s.asideOpen === false, "Escape closes the drawer");
  assert(s.backdropOpacity === "0", "backdrop hidden again after Escape");

  // ── Desktop: sticky in-flow column, no burger ──────────────────────────────
  await setViewport(client, DESKTOP);
  await sleep(300);
  console.log("desktop (1280px):");
  s = await probe();
  assert(s.burgerDisplay === "none", "burger is hidden on desktop");
  assert(s.asideVisibility === "visible", "sidebar is visible on desktop");
  assert(s.asidePosition === "sticky", "sidebar is a sticky column on desktop");
  assert(s.asideRect.left >= 0, "sidebar sits in the page flow (not off-canvas)");
  assert(s.backdropDisplay === "none", "backdrop is removed on desktop");

  client.close();
}

try {
  await run();
  console.log(`\n✅ mobile-drawer e2e — ${passed} checks passed`);
  process.exitCode = 0;
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.stop(true);
}
