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

// Minimal CDP client (page-target WebSocket), mirroring web-docs/tests/e2e.
async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  // Every console.error and uncaught exception the page logs. A silent hydration bug
  // (a per-component mismatch → CSR rebuild) surfaces here as `[otfw:hydrate] …`, so the
  // suite can assert the page hydrated with a clean console, not just a correct final DOM.
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
    // list region (Phase 2.1a): each server <li> should be adopted (carry the __server tag),
    // and a reactive change reconciles from that adopted state.
    listItems: Array.from(document.querySelectorAll('#app ul.items li')).map((li) => ({
      text: norm(li),
      server: !!li.__server,
    })),
    // conditional region (Phase 2.1b): the server rendered the true branch (p.yes); it
    // should be adopted, then a toggle swaps to the false branch (span.no).
    condYes: (() => { const p = document.querySelector('#app .cond p.yes'); return p ? { text: norm(p), server: !!p.__server } : null; })(),
    condNo: (() => { const s = document.querySelector('#app .cond span.no'); return s ? norm(s) : null; })(),
    // layout chain (Phase 2.1c): the page is wrapped in a layout whose {children} slot holds
    // the page's DOM. The layout's own nodes must adopt, and the nested page must sit inside.
    layoutIsServer: (() => { const l = document.querySelector('#app .layout'); return !!(l && l.__server); })(),
    headerIsServer: (() => { const h = document.querySelector('#app .layout > .site-header'); return !!(h && h.__server); })(),
    headerText: norm(document.querySelector('#app .site-header')),
    pageInsideLayout: !!document.querySelector('#app .layout > main'), // page nested at the slot
    // component {children} slot (Phase 2.1d): a <Card> island with a slotted button. The Card
    // adopts its OWN structure/toggle (skipSlot), and the PAGE adopts the slotted button
    // (hydrateSlot) — its reactivity (count) is the page's, not the card's.
    cardIsServer: (() => { const c = document.querySelector('#app .card'); return !!(c && c.__server); })(),
    cardToggleText: norm(document.querySelector('#app .card-toggle')),
    slotted: (() => { const b = document.querySelector('#app .slotted'); return b ? { text: norm(b), server: !!b.__server } : null; })(),
    // Eagerly-defined Link island + a component children slot, under recursion (the
    // sidebar shape). A web-link that built instead of adopting re-wraps its server
    // anchor in a fresh one (an a-inside-an-a); a nested Tree whose rich node prop got
    // clobbered renders the wrong branch (a group span where the server rendered a link).
    // Probe both: the nested-anchor count and each rendered leaf/group.
    nestedAnchors: document.querySelectorAll('#app a a').length,
    treeLinks: Array.from(document.querySelectorAll('#app .tree a.tree-link')).map((a) => ({
      href: a.getAttribute('href'),
      text: norm(a),
      hasDot: !!a.querySelector('.tree-dot'),
      server: !!a.__server,
    })),
    treeGroups: Array.from(document.querySelectorAll('#app .tree .tree-group')).map((s) => ({
      text: norm(s),
      server: !!s.__server,
    })),
    // A component whose root is a conditional (Fragment root): the true branch <b>ON should
    // be adopted, not destroyed-and-rebuilt.
    pill: (() => { const b = document.querySelector('#app .pill-host b.pill-on'); return b ? { text: norm(b), server: !!b.__server } : null; })(),
    pillOff: !!document.querySelector('#app .pill-host i.pill-off'),
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
    assert(s.buttonCount === 6, "six <button>s (counter + stepper + 'add' + 'toggle' + card-toggle + slotted) — nothing duplicated");

    // ── 1e. The layout chain self-adopted (Phase 2.1c) ──────────────────────────
    assert(s.layoutIsServer, "the layout <div.layout> is a server node (adopted, not rebuilt)");
    assert(s.headerIsServer && s.headerText === "E2E_LAYOUT", "the layout's static <header> adopted with its text");
    assert(s.pageInsideLayout, "the page's <main> is nested inside the layout's {children} slot");

    // ── 1f. A component's own {children} slot self-adopted (Phase 2.1d) ─────────
    assert(s.cardIsServer, "the <Card> island's <div.card> is a server node (adopted its own structure)");
    assert(s.cardToggleText === "card 0", "the Card's own reactive state rendered (its $state, its skipSlot walk)");
    assert(s.slotted && s.slotted.server, "the slotted <button> is a server node (adopted, not rebuilt)");
    assert(s.slotted.text === "slotted 0", "the slotted button shows the parent's count (parent-owned reactivity)");
    assert(s.removedServer === 0, "no server-rendered node was removed (no CSR rebuild)");
    assert(s.mainIsServer, "the live <main> is the server-rendered node (adopted)");
    assert(s.incIsServer, "the page's counter <button> is the server-rendered node (adopted)");
    assert(s.countText === "count 0", "the server-rendered count is preserved through hydrate");

    // ── 1g. Eagerly-defined <Link> island + recursion + conditional root ────────
    // These compositions regress-guard three foundation bugs the single-island fixture
    // above never exercised (all silent — a correct-looking final DOM, no thrown error
    // for the double-build): an eagerly-defined <Link> that builds instead of adopts, a
    // recursive tree whose child rich-props get clobbered, and a conditional-root
    // (Fragment) component that destroys-and-rebuilds.
    assert(s.nestedAnchors === 0, "no <a> nested inside another <a> — no <web-link> double-built its server <a>");
    assert(s.treeLinks.length === 3, "the tree rendered its three leaf links (Alpha, Bravo, Charlie)");
    assert(
      s.treeLinks.every((l) => l.server && l.hasDot),
      "every tree link is a server node (adopted) and kept its slotted <span.tree-dot>",
    );
    assert(
      s.treeLinks.map((l) => l.href).join(",") === "/a,/b,/c",
      "each tree link adopted its own href — nested rich `node` props were not clobbered",
    );
    assert(
      s.treeGroups.length === 2 &&
        s.treeGroups.map((g) => g.text).sort().join(",") === "Group,Root" &&
        s.treeGroups.every((g) => g.server),
      "both group nodes (no path) adopted their <span.tree-group> — the conditional picked the right branch",
    );
    assert(s.pill && s.pill.server && s.pill.text === "ON", "the conditional-root <Pill> adopted its rendered branch (<b>ON)");
    assert(!s.pillOff, "the untaken <Pill> branch (<i>OFF) is absent, as the server rendered");
    // Nothing rebuilt anywhere during the whole first paint (islands, tree, pill included).
    assert(s.removedServer === 0, "still no server node removed after the tree/pill islands adopted");
    // A per-component mismatch would have been reported to the console even though the DOM
    // self-heals — the console must be clean for a genuinely correct hydration.
    const hydrationErrors = client.pageErrors.filter((e) => /otfw:(hydrate|render)|HydrationMismatch/.test(e));
    assert(
      hydrationErrors.length === 0,
      `no hydration errors logged (found ${hydrationErrors.length}: ${hydrationErrors.slice(0, 3).join(" | ")})`,
    );

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

    // ── 1c. The list region self-adopted (Phase 2.1) ────────────────────────────
    assert(s.listItems.length === 3, "the server rendered three <li> items");
    assert(
      s.listItems.every((it, i) => it.text === `item ${i + 1}`),
      "the list items carry their server-rendered text",
    );
    assert(s.listItems.every((it) => it.server), "every <li> is a server node (adopted, not rebuilt)");

    // ── 1d. The conditional region self-adopted (Phase 2.1b) ────────────────────
    assert(s.condYes && s.condYes.text === "YES", "the conditional rendered its `true` branch (<p>YES)");
    assert(s.condYes.server, "the conditional branch <p> is a server node (adopted, not rebuilt)");
    assert(s.condNo === null, "the untaken branch (<span>NO) is absent, as the server rendered");

    // ── 2. Interactivity is live on every adopted island + the list ─────────────
    await evalJS(client, `document.querySelector('#app main > button').click()`);
    await evalJS(client, `document.querySelector('#app .stepper').click()`);
    await evalJS(client, `document.querySelector('#app button.add').click()`); // append a 4th item
    await evalJS(client, `document.querySelector('#app .card-toggle').click()`); // the Card's own state
    await evalJS(client, `document.querySelector('#app .slotted').click()`); // parent's count via the slot
    await sleep(50);
    const after = await evalJS(client, PROBE);
    // The page counter and the slotted button share the page's `count` signal; clicking inc
    // and the slotted button each once brings it to 2, updating both bound text nodes.
    assert(after.countText === "count 2", "the page counter reflects both its own + the slotted click");
    assert(after.slotted.text === "slotted 2", "the slotted button's parent-owned reactivity is live and shared");
    assert(after.slotted.server, "the slotted button stayed the same adopted node through updates");
    assert(after.cardToggleText === "card 1", "the Card's own button incremented its independent $state (skipSlot walk wired it)");
    assert(after.incIsServer, "the page button is still the same adopted node after the update");
    assert(after.stepperText === "Steps n=8", "clicking the component button increments its own signal (prop intact)");
    assert(after.stepperBtnIsServer, "the component button is still the same adopted node");
    // The list reconciled from the adopted state: the three server <li> stayed (still tagged),
    // and a fourth was built and appended — no server node was torn out.
    assert(after.listItems.length === 4, "clicking 'add' reconciled a fourth <li> into the list");
    assert(
      after.listItems.slice(0, 3).every((it) => it.server),
      "the three adopted <li> kept their identity through reconcile (no rebuild)",
    );
    assert(after.listItems[3].text === "item 4", "the appended <li> built with the right text");
    // A rebuild-on-reconcile would replaceChildren() the <ul>, tearing out the three tagged
    // server <li> (removedServer += 3). It stays 0 → the originals were kept, a 4th appended.
    assert(after.removedServer === 0, "reactivity updated in place — still no server node removed");

    // ── 3. The conditional swaps on toggle (removing the adopted branch is correct here) ──
    await evalJS(client, `document.querySelector('#app button.toggle').click()`);
    await sleep(50);
    const swapped = await evalJS(client, PROBE);
    assert(swapped.condYes === null, "toggling removed the adopted `true` branch (<p>YES)");
    assert(swapped.condNo === "NO", "toggling swapped in the freshly-built `false` branch (<span>NO)");
    // Exactly one server node (the adopted <p>) was removed by the swap — not a page rebuild
    // (that would also tear out <main>, the counter, the list…: removedServer would be >1).
    // (The observer also tags client-built nodes, so this count is only meaningful up to the
    // first post-hydration swap; that's enough to distinguish a branch swap from a rebuild.)
    assert(swapped.removedServer === 1, "the swap removed only the adopted branch node, nothing else");
    // Toggling back rebuilds the first branch (freshly built now — no adopted node involved).
    await evalJS(client, `document.querySelector('#app button.toggle').click()`);
    await sleep(50);
    const back = await evalJS(client, PROBE);
    assert(back.condYes && back.condYes.text === "YES", "toggling back renders the first branch again");
    assert(back.condNo === null, "the false branch is gone after toggling back");

    // ── 4. SPA navigation to a loader route fetches <path>/__data.json ──────────
    // (docs/DATA.md) The /todos page's list exists only in its loader's data, so
    // rendering it after a client-side navigation proves the router fetched the
    // data endpoint and committed it as router.data — no full page load involved
    // (pushState + popstate drives the exact same `navigate()` path a <Link>
    // click takes, without adding an island to the adoption probes above).
    // Run last: the route swap replaces #app's children, which ends the usefulness
    // of the identity/removedServer probes.
    await evalJS(
      client,
      `history.pushState({}, '', '/todos'); window.dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await sleep(300); // client nav: route chunk import + data fetch + swap
    const nav = await evalJS(
      client,
      `(() => ({
        path: location.pathname,
        text: (document.querySelector('#app')?.textContent || '').replace(/\\s+/g, ' '),
      }))()`,
    );
    assert(nav.path === "/todos", "the client router navigated to /todos (no page load)");
    assert(nav.text.includes("E2E_TODOS"), "the /todos page rendered after SPA navigation");
    assert(nav.text.includes("todo alpha"), "SPA navigation fetched the loader data (__data.json) and rendered it");

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
