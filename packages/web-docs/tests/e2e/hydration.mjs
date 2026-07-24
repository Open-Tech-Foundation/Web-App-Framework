// Browser e2e for the docs shell's **hydration** — the gap that let the docs site ship broken
// twice while this package's suite stayed green.
//
// Every other test in web-docs mounts components through the CSR path, so a layout could
// hydrate-crash in production and nothing here would notice. This drives the real thing: otfwc
// compiles the harness twice — `--target=ssg` for the server HTML and `--target=hydrate` for
// the client bundle — and headless Chromium adopts the one with the other, exactly as a
// pre-rendered page does.
//
// `<DocsLayout>` is the shape every hydration bug in this package has come through: a
// JSX-value local (`const body = <jsx>`) that slots `{props.children}`, rendered via
// `frame ? <shell>{body}</shell> : body`. Both branches are covered; `frame={false}` is the
// docs site's own call site (website/app/docs/layout.jsx) and the branch whose build template
// `hydrateChild` actually evaluates.
//
// What it asserts, per branch:
//   1. No error reached the console (a `ReferenceError` out of the adopt branch, or a
//      `HydrationMismatch`, is reported there rather than thrown).
//   2. No server node was rebuilt — a document-start MutationObserver tags every node the
//      parser inserts, and every tagged node must still be in the document afterwards.
//   3. The slotted children are still in the prose slot, exactly once (a discarded build that
//      re-slots would `appendChild` them into a throwaway tree and empty the slot).
//
//   bun packages/web-docs/tests/e2e/hydration.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium (CHROME_BIN
// overrides; skips cleanly if absent). Exits 0 if every assertion holds, 1 otherwise.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const THEME_CSS = ROOT + "packages/web-docs/theme/index.css";
const HARNESS = HERE + "hydration-harness.jsx";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping web-docs hydration e2e — no Chromium at ${CHROME} (set CHROME_BIN)`);
  process.exit(0);
}

let passed = 0;
const failures = [];
// Collect rather than throw: both branches should be reported on every run, so one broken
// branch doesn't hide the state of the other.
function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Compile the harness for a target ──────────────────────────────────────────
// `page`/`layout`/`404` basenames compile to route factories, everything else to a Custom
// Element — the same rule the toolchain and the unit preload use.
const otfwPlugin = (target) => ({
  name: `otfw-${target}`,
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      const base = args.path.split("/").pop().replace(/\.[jt]sx$/, "");
      const isRoute = base === "page" || base === "layout" || base === "404";
      const argv = ["build"];
      if (!isRoute) argv.push("--component");
      argv.push(`--target=${target}`, "--stdin", args.path);
      const source = await Bun.file(args.path).text();
      const proc = Bun.spawnSync([OTFWC, ...argv], {
        stdin: new TextEncoder().encode(source),
      });
      if (proc.exitCode !== 0) throw new Error(`otfwc ${target} ${args.path}:\n${proc.stderr}`);
      return { contents: proc.stdout.toString(), loader: "js" };
    });
  },
});

async function bundle(target, entry, format) {
  const built = await Bun.build({
    entrypoints: [entry],
    target: format,
    plugins: [otfwPlugin(target)],
    external: format === "bun" ? [] : undefined,
  });
  if (!built.success) {
    for (const log of built.logs) console.error(log);
    throw new Error(`bundle failed (${target})`);
  }
  return await built.outputs[0].text();
}

// ── 1. Server-render with the SSG backend ─────────────────────────────────────
// The SSG module registers each component's renderer in the `defineSSG` registry; rendering
// the harness host through `ssgComponent` produces exactly the markup a pre-rendered page
// embeds, slot markers and all.
const ssgEntry = HERE + ".hydration-ssg-entry.js";
// Rich props (here `frame={false}`) cross to the client through the serialized island
// payload, not as host attributes — so the render must be bracketed by the collector and the
// page must embed the resulting JSON, exactly as the real SSG shell does. Without it the
// client falls back to attributes, reads `frame` as null, and takes the *other* branch: a
// guaranteed mismatch that says nothing about the code under test.
await Bun.write(
  ssgEntry,
  `import harness from "${HARNESS}";
   import { ssgComponent, beginHydrationCollect, endHydrationCollect } from "@opentf/web/server";
   globalThis.__render = (props) => {
     beginHydrationCollect();
     const html = ssgComponent(harness.tag, props, "");
     return { html, payload: endHydrationCollect() };
   };`,
);
const ssgBundle = await bundle("ssg", ssgEntry, "bun");
const ssgMod = HERE + ".hydration-ssg-bundle.mjs";
await Bun.write(ssgMod, ssgBundle);
// The runtime defines `class … extends HTMLElement` at load (the CSR custom elements). Server
// render never instantiates them, but the base class must exist for those definitions to
// evaluate — the same bare stub the toolchain's SSG step installs (web-cli/src/shared.js).
// `customElements` stays undefined, so nothing self-registers outside the browser.
globalThis.HTMLElement ??= class {};
await import(ssgMod);
const renderServer = globalThis.__render;

// ── 2. The client (hydrate) bundle ────────────────────────────────────────────
const clientEntry = HERE + ".hydration-client-entry.js";
await Bun.write(
  clientEntry,
  `import "${HARNESS}";
   import { beginHydration, endHydration } from "@opentf/web";
   // Mirror the router's first-paint bracket: set the flag before the server hosts upgrade,
   // clear it once they have. The harness host upgrades on define (it is already in the DOM),
   // so the whole adopt pass happens inside this bracket.
   beginHydration();
   queueMicrotask(() => { endHydration(); window.__hydrated = true; });`,
);
const clientBundle = await bundle("hydrate", clientEntry, "browser");
const themeCSS = await Bun.file(THEME_CSS).text();

// Tag every node the parser inserts, at document-start, so a rebuild is detectable: a rebuilt
// subtree drops the tagged nodes and inserts fresh untagged ones.
const OBSERVER = `
  window.__removed = [];
  window.__errors = [];
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (!n.__server) n.__server = true;
      for (const n of r.removedNodes) if (n.__server) window.__removed.push(n.nodeName);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("error", (e) => window.__errors.push(String(e.message)));
  addEventListener("otfw:error", (e) => window.__errors.push(String(e.detail && e.detail.error)));
  const _ce = console.error;
  console.error = (...a) => { window.__errors.push(a.map(String).join(" ")); _ce(...a); };
`;

function pageHTML(serverMarkup, payload) {
  return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<script>${OBSERVER}</script><style>${themeCSS}</style></head>
<body><div id="app" data-otfw-hydrate>${serverMarkup}</div>
<script type="application/json" id="__otfw_h">${payload}</script>
<script type="module">${clientBundle}</script></body></html>`;
}

// ── Serve ─────────────────────────────────────────────────────────────────────
let currentHTML = "";
const server = Bun.serve({
  port: 0,
  fetch: () => new Response(currentHTML, { headers: { "content-type": "text/html" } }),
});
const origin = `http://127.0.0.1:${server.port}`;

// ── Minimal CDP client ────────────────────────────────────────────────────────
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
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const m = ++id;
      pending.set(m, { res, rej });
      ws.send(JSON.stringify({ id: m, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function evalJS(client, expression) {
  const r = await client.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.text}`);
  return r.result.value;
}

// Read everything the assertions need, in one round trip.
const PROBE = `(() => {
  const app = document.querySelector('#app');
  const prose = document.querySelector('.otfw-prose');
  const heading = document.querySelector('.probe-heading');
  return {
    errors: window.__errors || [],
    removed: window.__removed || [],
    hydrated: !!window.__hydrated,
    hasProse: !!prose,
    headingCount: document.querySelectorAll('.probe-heading').length,
    bodyCount: document.querySelectorAll('.probe-body').length,
    headingText: heading ? heading.textContent : null,
    headingInProse: !!(heading && prose && prose.contains(heading)),
    headingIsServer: !!(heading && heading.__server),
    proseIsServer: !!(prose && prose.__server),
    hasShell: !!document.querySelector('.otfw-shell'),
    appHTMLHead: app ? app.innerHTML.slice(0, 120) : null,
  };
})()`;

// ── Run both branches ─────────────────────────────────────────────────────────
async function checkBranch(client, { frame, label }) {
  console.log(`\n  — ${label} —`);
  // Assert on the server markup, never on `currentHTML` — the page inlines the theme CSS,
  // which mentions every one of these class names.
  const { html: markup, payload } = renderServer({ config: {}, frame });
  currentHTML = pageHTML(markup, payload);

  assert(markup.includes("<!--c[-->"), `${label}: server HTML has the children-slot markers`);
  assert(
    markup.includes('class="probe-heading"'),
    `${label}: server HTML rendered the slotted heading`,
  );
  assert(
    frame ? markup.includes('class="otfw-shell"') : !markup.includes('class="otfw-shell"'),
    `${label}: server HTML rendered the ${frame ? "framed" : "unframed"} branch`,
  );

  await client.send("Page.navigate", { url: origin + "/?f=" + (frame ? 1 : 0) });
  await sleep(1200);
  const s = await evalJS(client, PROBE);

  assert(s.hydrated, `${label}: the hydration pass ran to completion`);
  assert(
    s.errors.length === 0,
    `${label}: no error logged during hydration${s.errors.length ? ` — ${JSON.stringify(s.errors.slice(0, 2))}` : ""}`,
  );
  assert(
    s.removed.length === 0,
    `${label}: no server node was torn out (adopted, not rebuilt)${s.removed.length ? ` — removed ${JSON.stringify(s.removed.slice(0, 6))}` : ""}`,
  );
  assert(s.hasProse, `${label}: the prose article survived hydration`);
  assert(s.proseIsServer, `${label}: the prose article is the server node`);
  assert(s.headingCount === 1, `${label}: the slotted heading exists exactly once`);
  assert(s.bodyCount === 1, `${label}: the slotted paragraph exists exactly once`);
  assert(s.headingText === "Hydration probe", `${label}: the slotted heading kept its text`);
  assert(
    s.headingInProse,
    `${label}: the slotted heading is still inside the prose slot (not stolen by a discarded build)`,
  );
  assert(s.headingIsServer, `${label}: the slotted heading is the server node, adopted in place`);
}

let client;
try {
  client = await connectPage();
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  console.log("web-docs hydration e2e — DocsLayout adopts its server DOM");
  // The docs site's own call site first: `frame={false}` is the branch whose build template
  // `hydrateChild` evaluates, and the one that crashed.
  await checkBranch(client, { frame: false, label: "frame={false} (docs-site call site)" });
  await checkBranch(client, { frame: true, label: "frame={true} (default chrome)" });

  if (failures.length) {
    console.log(`\n❌ web-docs hydration e2e — ${passed} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ web-docs hydration e2e — ${passed} checks passed`);
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill();
  server.stop(true);
  for (const f of [ssgEntry, ssgMod, clientEntry]) {
    try { await Bun.file(f).unlink(); } catch {}
  }
}
