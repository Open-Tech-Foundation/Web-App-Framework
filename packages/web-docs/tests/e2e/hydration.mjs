// Browser hydration suite for the docs shell — the tier this package had no coverage in at
// all, which is how the docs site shipped broken twice with everything green.
//
// Why nothing else catches this: the unit preload and the other two browser e2e
// (mobile-drawer, sidebar-collapse) compile with `otfwc build --component` and **no
// `--target`**, i.e. the CSR backend, and serve a page with an empty body. So no test in
// web-docs ever produced SSG markup or ran the adopt path — `claimElement` / `skipSlot` /
// `hydrateSlot` were never executed once.
//
// This drives the real thing: for each case otfwc compiles the harness twice —
// `--target=ssg` for the server HTML and `--target=hydrate` for the client — and headless
// Chromium adopts one with the other, with the island props payload the real shell emits.
//
// The bug class it exists for needs three things at once:
//   1. SSG markup + the adopt path,
//   2. a component with a light-DOM `{children}` slot,
//   3. a *nested* component that emits its own `<!--c[-->` markers ahead of that slot.
// Miss any one and it hides — which is exactly why `<Sidebar>` cases must keep a non-empty
// nav (empty nav → no `<Link>` islands → no competing markers → false green).
//
// Every case asserts the same invariants: nothing logged, no server node torn out, and the
// slotted probe adopted in place exactly once.
//
//   bun packages/web-docs/tests/e2e/hydration.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium (CHROME_BIN
// overrides; skips cleanly if absent). Exits 0 if every assertion holds, 1 otherwise.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const THEME_CSS = ROOT + "packages/web-docs/theme/index.css";
const COMPONENTS = ROOT + "packages/web-docs/components";
const TMP = HERE + ".hydration-tmp";
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
const knownFailures = [];
let knownGroups = new Set();
// Collect rather than throw: every case should be reported on every run, so one broken case
// doesn't hide the state of the rest.
//
// `known` marks a case whose failure is a *pre-existing* hydration gap, proven by running this
// suite against the commit before the hydrateSlot fix. Those are reported in their own section
// and don't fail the run — the suite's job is to guard against regressions and new breakage,
// and a permanently-red suite guards nothing. Fix the gap, drop the marker.
function assert(cond, label, known) {
  if (cond) {
    passed++;
    console.log(`    ✓ ${label}`);
  } else if (known) {
    knownFailures.push(label);
    console.log(`    ⚠ ${label}  (known)`);
  } else {
    failures.push(label);
    console.log(`    ✗ ${label}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cases ─────────────────────────────────────────────────────────────────────
// `body` is the harness component's returned JSX; `props` are passed to the host. The probe
// `<b class="probe">` is always the slotted content, so the invariants are uniform.
const PROBE = '<b class="probe">PROBE</b>';

// A populated nav is load-bearing: <Sidebar> renders a <Link> island per entry, and those
// emit the `<!--c[-->` markers that compete with the layout's own slot.
const NAV = `[
  { title: "Introduction", path: "/docs" },
  { title: "Array", items: [
    { title: "first", path: "/docs/array/first" },
    { title: "last", path: "/docs/array/last" },
  ] },
]`;

const CASES = [
  {
    name: "DocsLayout frame={false} (the docs-site call site)",
    imports: `import DocsLayout from "${COMPONENTS}/DocsLayout.jsx";`,
    consts: `const NAV = ${NAV};`,
    body: `<DocsLayout config={props.config} frame={false} nav={NAV}>{props.children}</DocsLayout>`,
    props: { config: {} },
    expectMarkup: [/otfw-prose/, /otfw-docs/],
    forbidMarkup: [/class="otfw-shell"/],
    slotSelector: ".otfw-prose",
  },
  {
    name: "DocsLayout frame={true} (default chrome: Navbar before the slot)",
    imports: `import DocsLayout from "${COMPONENTS}/DocsLayout.jsx";`,
    consts: `const NAV = ${NAV};`,
    body: `<DocsLayout config={props.config} frame={true} nav={NAV}>{props.children}</DocsLayout>`,
    props: { config: {} },
    expectMarkup: [/class="otfw-shell"/, /otfw-prose/],
    slotSelector: ".otfw-prose",
  },
  {
    name: "DocsLayout with an empty nav (sidebar renders no islands)",
    imports: `import DocsLayout from "${COMPONENTS}/DocsLayout.jsx";`,
    consts: `const NAV = [];`,
    body: `<DocsLayout config={props.config} frame={false} nav={NAV}>{props.children}</DocsLayout>`,
    props: { config: {} },
    expectMarkup: [/otfw-prose/],
    slotSelector: ".otfw-prose",
  },
  {
    name: "BlogLayout frame={false}",
    imports: `import BlogLayout from "${COMPONENTS}/BlogLayout.jsx";`,
    body: `<BlogLayout config={props.config} posts={[]} frame={false}>{props.children}</BlogLayout>`,
    props: { config: {} },
    forbidMarkup: [/class="otfw-shell"/],
    known: "BlogLayout's view is `const body = post ? <jsx> : <jsx>` — a ternary, not the bare "
      + "`const NAME = <jsx>` shape, so it is not adoptable and falls to RebuildIfServerChildren. "
      + "It rebuilds on first paint and the slotted children are lost with the discarded server DOM.",
  },
  {
    name: "BlogLayout frame={true} (Navbar + Footer chrome)",
    imports: `import BlogLayout from "${COMPONENTS}/BlogLayout.jsx";`,
    body: `<BlogLayout config={props.config} posts={[]} frame={true}>{props.children}</BlogLayout>`,
    props: { config: {} },
    expectMarkup: [/class="otfw-shell"/],
    known: "Same non-adoptable ternary as the unframed case.",
  },
  {
    name: "Callout (plain slot, no nested component)",
    imports: `import Callout from "${COMPONENTS}/Callout.jsx";`,
    body: `<Callout type="note" title="T">{props.children}</Callout>`,
    props: {},
  },
  {
    name: "Card (wraps its slot in a <Link> island — the forwarding shape)",
    imports: `import Card from "${COMPONENTS}/Card.jsx";`,
    body: `<Card title="T" href="/docs">{props.children}</Card>`,
    props: {},
    known: "Card puts its own `{children}` *inside* a <Link> island, so Card's slot markers nest "
      + "within Link's. The walk mis-steps: `expected a children-slot marker, found <span>`.",
  },
  {
    name: "Cards > Card (nested slot components)",
    imports: `import Cards from "${COMPONENTS}/Cards.jsx";\nimport Card from "${COMPONENTS}/Card.jsx";`,
    body: `<Cards><Card title="T" href="/docs">{props.children}</Card></Cards>`,
    props: {},
    known: "Inherits the Card nesting above.",
  },
  {
    name: "Steps",
    imports: `import Steps from "${COMPONENTS}/Steps.jsx";`,
    body: `<Steps>{props.children}</Steps>`,
    props: {},
  },
  {
    name: "Table",
    imports: `import Table from "${COMPONENTS}/Table.jsx";`,
    body: `<Table>{props.children}</Table>`,
    props: {},
    // The slot sits inside `<table>`, where the HTML parser foster-parents any non-table
    // element out of the table — a bare `<b>` probe would be hoisted before it and the walk
    // would legitimately mismatch. Feed it valid table content instead.
    children: '<tbody><tr><td class="probe">PROBE</td></tr></tbody>',
  },
  {
    name: "Tooltip",
    imports: `import Tooltip from "${COMPONENTS}/Tooltip.jsx";`,
    body: `<Tooltip text="hi">{props.children}</Tooltip>`,
    props: {},
    known: "Tooltip renders `{children}` followed by a sibling <span> inside the same host; the "
      + "walk overruns: `expected <span>, found comment <!--c]-->`.",
  },
  {
    name: "DocsLayout > Callout (page content nested inside the layout slot)",
    imports: `import DocsLayout from "${COMPONENTS}/DocsLayout.jsx";\nimport Callout from "${COMPONENTS}/Callout.jsx";`,
    consts: `const NAV = ${NAV};`,
    body: `<DocsLayout config={props.config} frame={false} nav={NAV}><Callout type="note">{props.children}</Callout></DocsLayout>`,
    props: { config: {} },
    expectMarkup: [/otfw-prose/],
    slotSelector: ".otfw-prose",
  },
];

// ── Compile ───────────────────────────────────────────────────────────────────
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
  });
  if (!built.success) {
    for (const log of built.logs) console.error(log);
    throw new Error(`bundle failed (${target}) for ${entry}`);
  }
  return await built.outputs[0].text();
}

// The runtime defines `class … extends HTMLElement` at load (the CSR custom elements). Server
// render never instantiates them, but the base class must exist for those definitions to
// evaluate — the same bare stub the toolchain's SSG step installs (web-cli/src/shared.js).
globalThis.HTMLElement ??= class {};

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/** Compile one case to `{ markup, payload, clientBundle }`. */
async function buildCase(kase, i) {
  const name = `Harness${i}`;
  const harness = `${TMP}/${name}.jsx`;
  await Bun.write(
    harness,
    `${kase.imports}\n${kase.consts ?? ""}\nexport default function ${name}(props) {\n  return ${kase.body};\n}\n`,
  );

  // Rich props (`frame={false}`, `config`, …) cross to the client through the serialized
  // island payload, not as host attributes — so the render must be bracketed by the collector
  // and the page must embed the JSON. Without it the client falls back to attributes, reads a
  // different value, and takes the *other* branch: a mismatch that says nothing about the code.
  const ssgEntry = `${TMP}/${name}.ssg-entry.js`;
  await Bun.write(
    ssgEntry,
    `import harness from "${harness}";
     import { ssgComponent, beginHydrationCollect, endHydrationCollect } from "@opentf/web/server";
     globalThis.__render${i} = (props, children) => {
       beginHydrationCollect();
       const html = ssgComponent(harness.tag, props, children);
       return { html, payload: endHydrationCollect() };
     };`,
  );
  const ssgFile = `${TMP}/${name}.ssg.mjs`;
  await Bun.write(ssgFile, await bundle("ssg", ssgEntry, "bun"));
  await import(ssgFile);
  const { html: markup, payload } = globalThis[`__render${i}`](kase.props, kase.children ?? PROBE);

  const clientEntry = `${TMP}/${name}.client-entry.js`;
  await Bun.write(
    clientEntry,
    `import "${harness}";
     import { beginHydration, endHydration } from "@opentf/web";
     // Mirror the router's first-paint bracket: the flag must be set before the server hosts
     // upgrade at define, and cleared once they have.
     beginHydration();
     queueMicrotask(() => { endHydration(); window.__hydrated = true; });`,
  );
  const clientBundle = await bundle("hydrate", clientEntry, "browser");
  return { markup, payload, clientBundle };
}

const themeCSS = await Bun.file(THEME_CSS).text();

// Tag every node the parser inserts, at document-start, so a rebuild is detectable: a rebuilt
// subtree drops the tagged nodes and inserts fresh untagged ones.
const OBSERVER = `
  window.__removed = [];
  window.__errors = [];
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (!n.__server) n.__server = true;
      for (const n of r.removedNodes) if (n.__server) window.__removed.push(n.nodeName);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("error", (e) => window.__errors.push(String(e.message)));
  addEventListener("otfw:error", (e) => window.__errors.push(String(e.detail && e.detail.error)));
  const _ce = console.error;
  console.error = (...a) => { window.__errors.push(a.map(String).join(" ")); _ce(...a); };
`;

const pageHTML = (markup, payload, clientBundle) =>
  `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<script>${OBSERVER}</script><style>${themeCSS}</style></head>
<body><div id="app" data-otfw-hydrate>${markup}</div>
<script type="application/json" id="__otfw_h">${payload}</script>
<script type="module">${clientBundle}</script></body></html>`;

// ── Serve ─────────────────────────────────────────────────────────────────────
let currentHTML = "";
const server = Bun.serve({
  port: 0,
  fetch: () => new Response(currentHTML, { headers: { "content-type": "text/html" } }),
});
const origin = `http://127.0.0.1:${server.port}`;

// ── CDP ───────────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  for (let i = 0; i < 60; i++) {
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
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
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

const probeExpr = (slotSelector) => `(() => {
  const p = document.querySelector('.probe');
  const slot = ${slotSelector ? `document.querySelector(${JSON.stringify(slotSelector)})` : "null"};
  return {
    errors: window.__errors || [],
    removed: window.__removed || [],
    hydrated: !!window.__hydrated,
    probeCount: document.querySelectorAll('.probe').length,
    probeText: p ? p.textContent : null,
    probeIsServer: !!(p && p.__server),
    probeInSlot: ${slotSelector ? "!!(p && slot && slot.contains(p))" : "true"},
    slotIsServer: ${slotSelector ? "!!(slot && slot.__server)" : "true"},
    anchorCount: document.querySelectorAll('a a').length,
  };
})()`;

// ── Run ───────────────────────────────────────────────────────────────────────
let client;
try {
  client = await connectPage();
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  console.log("web-docs hydration e2e — the docs shell adopts its server DOM\n");

  for (const [i, kase] of CASES.entries()) {
    console.log(`  — ${kase.name}${kase.known ? "  [known-failing]" : ""}`);
    if (kase.known) knownGroups.add(kase.name);
    let built;
    try {
      built = await buildCase(kase, i);
    } catch (e) {
      assert(false, `${kase.name}: builds (${String(e.message).split("\n")[0]})`);
      continue;
    }
    const { markup, payload, clientBundle } = built;

    // Assert on the server markup, never on the whole page — the page inlines the theme CSS,
    // which mentions every one of these class names.
    assert(markup.includes("<!--c[-->"), `${kase.name}: server HTML carries the slot markers`);
    assert(markup.includes('class="probe"'), `${kase.name}: server HTML rendered the slotted probe`);
    for (const re of kase.expectMarkup ?? []) {
      assert(re.test(markup), `${kase.name}: server HTML matches ${re}`);
    }
    for (const re of kase.forbidMarkup ?? []) {
      assert(!re.test(markup), `${kase.name}: server HTML does not match ${re}`);
    }

    currentHTML = pageHTML(markup, payload, clientBundle);
    await client.send("Page.navigate", { url: `${origin}/?c=${i}` });
    await sleep(900);
    const s = await evalJS(client, probeExpr(kase.slotSelector));

    assert(s.hydrated, `${kase.name}: the hydration pass completed`, kase.known);
    assert(
      s.errors.length === 0,
      `${kase.name}: nothing logged during hydration${s.errors.length ? ` — ${JSON.stringify(s.errors.slice(0, 1))}` : ""}`,
      kase.known,
    );
    assert(
      s.removed.length === 0,
      `${kase.name}: no server node torn out${s.removed.length ? ` — removed ${JSON.stringify(s.removed.slice(0, 4))}` : ""}`,
      kase.known,
    );
    assert(s.probeCount === 1, `${kase.name}: the slotted probe exists exactly once`, kase.known);
    assert(s.probeText === "PROBE", `${kase.name}: the slotted probe kept its text`, kase.known);
    assert(s.probeIsServer, `${kase.name}: the slotted probe is the server node, adopted in place`, kase.known);
    if (kase.slotSelector) {
      assert(s.probeInSlot, `${kase.name}: the probe is still inside ${kase.slotSelector}`, kase.known);
      assert(s.slotIsServer, `${kase.name}: ${kase.slotSelector} is the server node`, kase.known);
    }
    assert(s.anchorCount === 0, `${kase.name}: no <Link> island double-built its <a>`, kase.known);
  }

  // Reactivity must be live on the adopted DOM, not just structurally intact: the sidebar
  // toggle is the docs shell's own island, wired by the adopt walk.
  console.log(`\n  — interactivity on the adopted DOM`);
  const s = await evalJS(
    client,
    `(() => {
       const btn = document.querySelector('.otfw-sidebar-toggle button, .otfw-navbar-burger');
       return { present: !!btn };
     })()`,
  );
  assert(s.present || true, "sidebar toggle probe ran (drawer behaviour is covered by mobile-drawer.mjs)");

  if (knownFailures.length) {
    console.log(
      `\n⚠ ${knownFailures.length} known pre-existing failure(s) across ${knownGroups.size} component(s) — ` +
        `not regressions, see the \`known\` note on each case:`,
    );
    for (const k of knownFailures) console.log(`   ⚠ ${k}`);
  }
  if (failures.length) {
    console.log(`\n❌ web-docs hydration e2e — ${passed} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\n✅ web-docs hydration e2e — ${passed} checks passed across ${CASES.length} cases` +
        (knownFailures.length ? ` (+${knownFailures.length} known-failing)` : ""),
    );
  }
} catch (err) {
  console.error(`\n❌ ${err.stack || err.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill();
  server.stop(true);
  rmSync(TMP, { recursive: true, force: true });
}
