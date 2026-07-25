// End-to-end hydration test (Phase 2.0 — see docs/HYDRATION.md). Proves the two
// backends compose: the SSG backend's server HTML (with text-hole markers) is *adopted*
// by the Hydrate backend's factory — the very same nodes, no rebuild — and reactivity
// then runs live on them, driven by a real DOM event.
//
// Unlike the rest of the suite (which compiles `.jsx` fixtures via the preload), this
// drives the otfwc binary directly so it can request the ssg/hydrate targets. It is
// skipped when the workspace debug build is absent (OTFWC_BIN overrides the path).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import {
  attr,
  beginHydrationCollect,
  defineSSG,
  endHydrationCollect,
  ssgComponent,
  ssgList,
  ssgText,
} from "../server/ssg-runtime.js";
// Side effect: registers the passthrough SSG renderers (web-internal-portal, …) into the
// ssg-runtime registry, so `ssgComponent("web-internal-portal", …)` emits the slot markers.
import "../server/builtins.js";
import {
  __resetHydrationPayload,
  afterHydration,
  beginHydration,
  bindAttr,
  bindChild,
  bindList,
  bindText,
  claimElement,
  claimRegionEnd,
  claimRegionStart,
  claimText,
  cursor,
  endHydration,
  handleError,
  HydrationMismatch,
  hydrateChild,
  hydrateHole,
  hydrateList,
  hydrateSlot,
  hydrationProps,
  isHydrating,
  runBuild,
  skipNode,
  skipSlot,
} from "./index.js";
// Side effect: registers the real <web-internal-portal> custom element used by the Portal test.
import "./portal.js";
import { reportError } from "../core/errors.js";

function findUp(name, from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const workspace = findUp("Cargo.toml", import.meta.dir);
const OTFWC = process.env.OTFWC_BIN ?? (workspace ? join(workspace, "target", "debug", "otfwc") : "otfwc");
const hasBin = existsSync(OTFWC);

// Compile `source` with otfwc for `target` (ssg | hydrate), returning the emitted JS.
// `component` selects the Custom Element backend (the page backend is the default).
function compile(source, target, component = false) {
  const args = [OTFWC, "build", `--target=${target}`, "--stdin"];
  if (component) args.push("--component");
  args.push(component ? "/app/Panel.tsx" : "/app/page.tsx");
  const proc = Bun.spawnSync(args, { stdin: new TextEncoder().encode(source) });
  if (proc.exitCode !== 0) throw new Error(`otfwc ${target} failed:\n${proc.stderr}`);
  return proc.stdout.toString();
}

// Evaluate an emitted *component* module and return the named binding (the element class, or
// the `_ssg` render fn). Unlike `loadModule` this keeps the declaration addressable, so the
// test can construct and connect the element by hand — happy-dom does not upgrade elements
// parsed out of `innerHTML`, so the adopt branch is only reachable by driving it directly.
function loadComponent(code, name, bindings) {
  const body = code
    .split("\n")
    .filter((l) => !l.startsWith("import "))
    .join("\n")
    .replace(/export class /g, "class ")
    .replace(/export function /g, "function ")
    .replace(/^export default \w+;$/gm, "");
  const names = Object.keys(bindings);
  return new Function(...names, `${body}\n; return ${name};`)(...names.map((n) => bindings[n]));
}

// Evaluate an emitted module, injecting the runtime helpers it imports (the code uses
// bare `@opentf/web` specifiers; we supply the real bindings), and return its exports.
// The hydrate target is a dual module — `default` (CSR build) + `hydrate` (adopt).
function loadModule(code, bindings) {
  const body = code
    .split("\n")
    .filter((l) => !l.startsWith("import "))
    .join("\n")
    .replace(/export default function\s*\(/g, "function __default(")
    .replace(/export function /g, "function ")
    // A component compiles to `export class NameElement …` (+ a bare `export default
    // NameElement;`); drop the `export` so the class registers via its own `define`.
    .replace(/export class /g, "class ")
    .replace(/^export default \w+;$/gm, "");
  const names = Object.keys(bindings);
  const ret =
    "\n; return {" +
    " default: typeof __default !== 'undefined' ? __default : undefined," +
    " hydrate: typeof hydrate !== 'undefined' ? hydrate : undefined," +
    " hydrateAt: typeof hydrateAt !== 'undefined' ? hydrateAt : undefined };";
  return new Function(...names, body + ret)(...names.map((n) => bindings[n]));
}

describe.skipIf(!hasBin)("hydration e2e (ssg → hydrate)", () => {
  // A counter so reactivity can be driven through a real DOM event on an adopted node.
  const source =
    'export default function P(){ let n=$state(3); return <div class="box"><button onclick={() => n++}>Count {n}</button></div>; }';

  test("the Hydrate factory adopts the SSG-rendered DOM and wires reactivity onto it", () => {
    // 1. Server render (SSG) → HTML string with text-hole markers.
    const ssgFactory = loadModule(compile(source, "ssg"), { signal, ssgText }).default;
    const html = ssgFactory();
    expect(html).toContain("<!--$-->3<!--/-->"); // value bracketed by hydration markers
    expect(html).not.toContain("onclick"); // event handler is client-only, never serialized

    // 2. Put it in the DOM as the browser would, and snapshot the server nodes.
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverDiv = container.firstChild;
    const serverButton = serverDiv.firstChild;
    const serverText = serverButton.childNodes[2]; // "Count ", <!--$-->, "3", <!--/-->
    expect(serverText.data).toBe("3");

    // 3. Hydrate over the existing container, using the dual module's `hydrate` export
    //    (its `default` is the CSR build factory used for client-side navigation).
    const mod = loadModule(compile(source, "hydrate"), {
      signal,
      bindText,
      cursor,
      claimElement,
      claimText,
      skipNode,
    });
    expect(typeof mod.default).toBe("function"); // CSR build factory is present too
    const root = mod.hydrate(container);

    // 4. Adoption — the same server nodes were claimed; nothing was re-created.
    expect(root).toBe(serverDiv);
    expect(serverDiv.firstChild).toBe(serverButton);
    expect(container.querySelectorAll("div").length).toBe(1);
    expect(container.querySelectorAll("button").length).toBe(1);
    expect(serverText.data).toBe("3"); // no flash / reset

    // 5. Reactivity is live on the adopted DOM: clicking the server-rendered button
    //    increments the signal and updates the *same* text node in place.
    serverButton.click();
    expect(serverText.data).toBe("4");
    expect(serverButton.childNodes[2]).toBe(serverText); // identity unchanged after update
  });

  // Compiler-driven data hydration: a server-rendered island's props cross to the client
  // through the serialized payload as a *rich* value (an object), not a string attribute.
  // This covers the SSG side (assign `data-h`, serialize the object) and the client reader
  // (resolve a host's rich props by its id). The remaining leg — the component constructor
  // reading it *at upgrade* — is validated in the real-browser e2e, because happy-dom does
  // not expose attributes in the constructor on upgrade (real browsers do, per the Custom
  // Elements spec), so the constructor path can't be exercised here.
  const islandSource =
    'function Badge({ meta }){ return <span class="badge">{meta.text}</span>; }' +
    ' export default function P(){ return <div><Badge meta={{ text: "hi", n: 7 }}/></div>; }';

  test("SSG serializes a rich island prop into the payload, and the reader resolves it", () => {
    // 1. Server render, collecting the island payload as renderRoute does.
    const ssg = loadModule(compile(islandSource, "ssg"), { signal, ssgText, ssgComponent, defineSSG });
    beginHydrationCollect();
    const html = ssg.default();
    const payload = endHydrationCollect();
    expect(html).toMatch(/<web-badge[^>]*\bdata-h="0"/); // the host carries a hydration id
    expect(html).not.toMatch(/<web-badge[^>]*\bmeta=/); // …but NOT the rich prop as an attribute
    expect(html).toContain("<!--$-->hi<!--/-->"); // rendered from the object's field
    // The whole object (incl. the unused `n`) is serialized — a real value, not a string.
    expect(JSON.parse(payload)).toEqual([{ meta: { text: "hi", n: 7 } }]);

    // 2. Inject the payload as the shell does, then the client reader resolves a host's
    //    rich props by its `data-h` id — the value the constructor reads at upgrade.
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const payloadScript = document.createElement("script");
    payloadScript.type = "application/json";
    payloadScript.id = "__otfw_h";
    payloadScript.textContent = payload;
    document.body.appendChild(payloadScript);
    __resetHydrationPayload(); // fresh document → re-read the script

    try {
      const host = container.querySelector("[data-h]");
      expect(hydrationProps(host)).toEqual({ meta: { text: "hi", n: 7 } });
      // A host with no id (a client-created element on SPA nav) resolves to null → the
      // component falls back to attributes/defaults, as a plain CSR build does.
      expect(hydrationProps(document.createElement("web-badge"))).toBe(null);
    } finally {
      container.remove();
      payloadScript.remove();
      __resetHydrationPayload();
    }
  });

  // Phase 2.1: a keyed list region hydrates. The server brackets it with `<!--[-->…<!--]-->`;
  // the Hydrate factory adopts each item's server node (no rebuild), then a reactive change
  // reconciles from that adopted state — kept items keep their identity, new items build.
  const listSource =
    "export default function P(){ let items=$state([1,2,3]);" +
    " return <div><button onclick={() => items = [...items, items.length+1]}>add</button>" +
    "<ul>{items.map(x => <li>item {x}</li>)}</ul></div>; }";

  test("the Hydrate factory adopts a server list region and reconciles from it with no flash", () => {
    // 1. Server render (SSG) → the list is bracketed by region markers.
    const ssgFactory = loadModule(compile(listSource, "ssg"), { signal, ssgText, ssgList }).default;
    const html = ssgFactory();
    expect(html).toContain("<!--[-->"); // list region opens
    expect(html).toContain("<!--]-->"); // …and closes
    expect(html).toMatch(/<li>item <!--\$-->1<!--\/--><\/li>/); // one root node per item

    // 2. Put it in the DOM and snapshot the three server <li> nodes.
    const container = document.createElement("div");
    container.innerHTML = html;
    const ul = container.querySelector("ul");
    const serverItems = Array.from(ul.querySelectorAll("li"));
    expect(serverItems.map((li) => li.textContent)).toEqual(["item 1", "item 2", "item 3"]);

    // 3. Hydrate over the existing container.
    const mod = loadModule(compile(listSource, "hydrate"), {
      signal,
      bindText,
      bindList,
      hydrateList,
      cursor,
      claimElement,
      claimText,
      skipNode,
    });
    mod.hydrate(container);

    // 4. Adoption — the three <li> were claimed, not re-created (same identities, no flash).
    const afterHydrate = Array.from(ul.querySelectorAll("li"));
    expect(afterHydrate.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(afterHydrate[i]).toBe(serverItems[i]);

    // 5. Reactivity reconciles from the adopted state: clicking "add" appends a fourth
    //    item (built via the CSR item fn), and the three adopted nodes keep their identity.
    container.querySelector("button").click();
    const afterAdd = Array.from(ul.querySelectorAll("li"));
    expect(afterAdd.length).toBe(4);
    for (let i = 0; i < 3; i++) expect(afterAdd[i]).toBe(serverItems[i]); // kept, not rebuilt
    expect(afterAdd[3].textContent).toBe("item 4"); // newly built, in order before the anchor
  });

  // Phase 2.1b: a conditional / dynamic-node region hydrates. The server brackets the
  // rendered branch with `<!--[-->…<!--]-->`; the Hydrate factory adopts that branch's
  // node (no rebuild), then a reactive change swaps to the freshly-built other branch.
  const condSource =
    "export default function P(){ let open=$state(true);" +
    " return <div><button onclick={() => open = !open}>t</button>" +
    '{open ? <p class="yes">YES</p> : <span class="no">NO</span>}</div>; }';

  test("the Hydrate factory adopts the rendered conditional branch and swaps on change", () => {
    // 1. Server render (SSG) → the rendered branch bracketed by region markers.
    const ssgFactory = loadModule(compile(condSource, "ssg"), { signal, ssgText }).default;
    const html = ssgFactory();
    expect(html).toContain("<!--[-->"); // region opens
    expect(html).toMatch(/<p class="yes">YES<\/p>/); // the `true` branch was rendered
    expect(html).not.toContain("NO"); // …not the other branch

    // 2. Put it in the DOM and snapshot the server <p>.
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverP = container.querySelector("p.yes");
    expect(serverP.textContent).toBe("YES");

    // 3. Hydrate over the existing container.
    const mod = loadModule(compile(condSource, "hydrate"), {
      signal,
      bindChild,
      hydrateChild,
      cursor,
      claimElement,
      claimText,
      skipNode,
    });
    mod.hydrate(container);

    // 4. Adoption — the server <p> was claimed, not re-created (same identity, no flash).
    expect(container.querySelector("p.yes")).toBe(serverP);

    // 5. Clicking toggles the condition → the region swaps to the other branch, built via
    //    the CSR branch fn; the adopted <p> is removed and a <span> takes its place.
    container.querySelector("button").click();
    expect(container.querySelector("p.yes")).toBe(null);
    expect(container.querySelector("span.no")?.textContent).toBe("NO");

    // …and toggling back renders the first branch again (freshly built now, not adopted).
    container.querySelector("button").click();
    expect(container.querySelector("span.no")).toBe(null);
    expect(container.querySelector("p.yes")?.textContent).toBe("YES");
  });

  // Phase 2.1c: a layout chain hydrates. The compiled layout's `hydrateAt` claims its own
  // structure and hands its cursor to the page's `hydrateAt` at the `{children}` slot — one
  // cursor threading both modules, exactly as the router does. Proves the *emitted* contract.
  const layoutSource =
    'export default function Layout({ children }){ return <div class="layout"><header>H</header>{children}</div>; }';
  const innerPageSource =
    'export default function P(){ let n=$state(5); return <main><button onclick={() => n++}>c {n}</button></main>; }';

  test("a compiled layout adopts its chain — layout + page thread one cursor at the slot", () => {
    const helpers = { signal, ssgText };
    // 1. Server-compose exactly like renderRoute: render the page, wrap in the layout.
    const pageSsg = loadModule(compile(innerPageSource, "ssg"), helpers).default;
    const layoutSsg = loadModule(compile(layoutSource, "ssg"), helpers).default;
    const html = layoutSsg({ children: pageSsg({}) });
    expect(html).toMatch(/<div class="layout"><header>H<\/header><!--\[-->/); // slot region opens
    expect(html).toContain("<main><button>c <!--$-->5<!--/--></button></main>"); // page inside

    // 2. Put it in the DOM; snapshot the layout + nested page server nodes.
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverLayout = container.querySelector(".layout");
    const serverMain = container.querySelector("main");
    const serverBtn = container.querySelector("button");

    // 3. Compile both to the hydrate target and thread one cursor, as the router's
    //    `hydrateRouteNode` does: the layout adopts at the container and hands its cursor to
    //    the page thunk at the slot.
    const claimBindings = {
      signal,
      bindText,
      cursor,
      claimElement,
      claimText,
      skipNode,
      claimRegionStart,
      claimRegionEnd,
    };
    const layoutMod = loadModule(compile(layoutSource, "hydrate"), claimBindings);
    const pageMod = loadModule(compile(innerPageSource, "hydrate"), claimBindings);
    const rootNode = layoutMod.hydrateAt(cursor(container), {
      children: (c) => pageMod.hydrateAt(c, {}),
    });

    // 4. Adoption — both layers claimed their server nodes, nothing rebuilt.
    expect(rootNode).toBe(serverLayout);
    expect(container.querySelector(".layout")).toBe(serverLayout);
    expect(container.querySelector("main")).toBe(serverMain); // nested page adopted at the slot
    expect(container.querySelectorAll("main, button").length).toBe(2); // no duplication
    expect(serverBtn.textContent).toBe("c 5");

    // 5. Reactivity is live on the adopted nested-page node.
    serverBtn.click();
    expect(serverBtn.textContent).toBe("c 6");
    expect(container.querySelector("main")).toBe(serverMain); // identity unchanged
  });

  // Phase 2.1d: a component's light-DOM `{children}` slot. The slotted content is the
  // *parent's* JSX (server-rendered inside the host at the `<!--c[-->…<!--c]-->` slot), so the
  // parent owns its reactivity: its adopt walk locates the slot via `hydrateSlot` and wires the
  // slotted node in place — order-independent of whether the component has upgraded. (The
  // component's own `skipSlot` walk is a Custom Element upgrade, validated in the browser e2e.)
  const slotSource =
    'function Card({ children }){ return <div class="card"><b>C</b>{children}</div>; }' +
    ' export default function P(){ let n=$state(0);' +
    ' return <main><Card><button class="inner" onclick={() => n++}>c {n}</button></Card></main>; }';

  test("a parent adopts a component's slotted children's reactivity (2.1d)", () => {
    // 1. Server render: the slot is bracketed by the distinct <!--c[-->…<!--c]--> markers,
    //    with the parent's <button class="inner"> rendered inside the host.
    const ssg = loadModule(compile(slotSource, "ssg"), {
      signal,
      ssgText,
      ssgComponent,
      defineSSG,
    }).default;
    const html = ssg({});
    expect(html).toContain("<!--c[web-card"); // component slot opens, labeled with its tag
    expect(html).toMatch(/<button class="inner">c <!--\$-->0<!--\/--><\/button>/); // parent JSX inside

    // 2. Put it in a DETACHED container so the Card custom element does NOT upgrade — proving
    //    the parent's slot adoption stands on its own (it scans for the marker, not the class).
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverInner = container.querySelector("button.inner");
    expect(serverInner.textContent).toBe("c 0");

    // 3. Run the page's adopt walk; it claims the host and adopts the slotted button via
    //    hydrateSlot (wiring the parent's `n` onto it).
    const mod = loadModule(compile(slotSource, "hydrate"), {
      signal,
      bindText,
      handleError,
      isHydrating,
      HydrationMismatch,
      reportError,
      cursor,
      claimElement,
      claimText,
      skipNode,
      skipSlot,
      hydrateSlot,
    });
    mod.hydrate(container);

    // 4. The slotted button was adopted in place (same node), and the parent's reactivity is
    //    live on it — clicking increments `n`, updating the same adopted text node.
    expect(container.querySelector("button.inner")).toBe(serverInner);
    serverInner.click();
    expect(serverInner.textContent).toBe("c 1");
    expect(container.querySelector("button.inner")).toBe(serverInner); // no rebuild
  });

  // Regression (esrun landing CodeTabs): a text hole `{expr}` whose value is a *JSX node*
  // stored in a data array — `{EXAMPLES.find(...).body}`. The compiler can't tell node from
  // text statically, so it emits the text path; SSG renders the node's markup inline in the
  // hole, and the client's `bindText` node arm *rebuilds* it. If hydration leaves the server
  // node in the hole, the rebuilt copy lands beside it and the example renders twice
  // ("AAAAAA"). claimText must strip the server node content so exactly one copy survives.
  const nodeHoleSource =
    'const EXAMPLES = [' +
    ' { id: "a", body: <code class="ex"><span>AAA</span></code> },' +
    ' { id: "b", body: <code class="ex"><span>BBB</span></code> } ];' +
    " export default function P(){ let sel=$state(\"a\");" +
    " return <div><div>{EXAMPLES.map((ex) => <button class=\"tab\" onclick={() => sel = ex.id}>{ex.id}</button>)}</div>" +
    " <pre>{EXAMPLES.find((ex) => ex.id === sel).body}</pre></div>; }";

  test("a node-valued text hole hydrates without duplicating the server-rendered node", () => {
    // 1. Server render — the <pre> hole carries the selected example's node markup inline.
    const ssg = loadModule(compile(nodeHoleSource, "ssg"), { signal, ssgText, ssgList }).default;
    const html = ssg();
    expect(html).toContain('<pre><!--$--><code class="ex"><span>AAA</span></code><!--/--></pre>');
    expect(html).not.toContain("BBB"); // only the selected example is server-rendered

    // 2. Put it in the DOM — exactly one code node before hydration.
    const container = document.createElement("div");
    container.innerHTML = html;
    const pre = container.querySelector("pre");
    expect(pre.querySelectorAll("code.ex").length).toBe(1);

    // 3. Hydrate.
    const mod = loadModule(compile(nodeHoleSource, "hydrate"), {
      signal,
      bindText,
      bindList,
      hydrateList,
      cursor,
      claimElement,
      claimText,
      skipNode,
    });
    mod.hydrate(container);

    // 4. Regression: still exactly one <code>, showing its text once (was two → "AAAAAA").
    expect(pre.querySelectorAll("code.ex").length).toBe(1);
    expect(pre.textContent).toBe("AAA");

    // 5. Reactivity still swaps the node in place when the selection changes.
    container.querySelectorAll("button.tab")[1].click();
    expect(pre.querySelectorAll("code.ex").length).toBe(1);
    expect(pre.textContent).toBe("BBB");
  });

  // Regression (web-docs navbar search on first paint): reactive content wrapped in
  // <Portal> was dead on first-paint hydration. Two coupled bugs: (1) the passthrough
  // built-ins' SSG omitted the <!--c[-->…<!--c]--> slot markers the compiled `hydrateSlot`
  // needs to find the children, and (2) the Portal relocated its children to <body> on
  // connect — *before* the owning component's adopt walk ran — tearing the slot out from
  // under `hydrateSlot`, so the portaled content's bindings were never wired (they only came
  // alive after a later CSR rebuild, e.g. an SPA navigation). The fix: emit the markers, and
  // defer the Portal's move until `endHydration` (afterHydration). This proves both: the
  // slotted button is adopted *in place* with live reactivity, then relocates exactly once.
  const portalSource =
    "export default function P(){ let n=$state(0);" +
    ' return <main><Portal><button class="m" onclick={() => n++}>c {n}</button></Portal></main>; }';

  test("a <Portal>'s slotted content hydrates in place before it relocates (Task 2)", () => {
    // 1. SSG: the portal's children are bracketed by the <!--c[-->…<!--c]--> slot markers
    //    (server/builtins.js) so the compiled `hydrateSlot` walk can locate and adopt them.
    const ssg = loadModule(compile(portalSource, "ssg"), {
      signal,
      ssgText,
      ssgComponent,
      defineSSG,
    }).default;
    const html = ssg();
    expect(html).toContain("<web-internal-portal><!--c[web-internal-portal-->"); // slot opens inside the host
    expect(html).toContain("<!--c]web-internal-portal--></web-internal-portal>"); // …and closes inside it

    // 2. Enter the first-paint pass, then connect the server DOM. The <web-internal-portal>
    //    upgrades on connect and would relocate now — but `_hydrating` is set, so it *defers*.
    beginHydration();
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverButton = container.querySelector("button.m");
    document.body.appendChild(container); // connect → portal defers its move
    expect(serverButton.closest("web-internal-portal")).not.toBeNull(); // still in the host

    // 3. Run the page's adopt walk while the slot is still in place; `hydrateSlot` finds the
    //    marker and wires the parent's `n` onto the server button (no rebuild).
    const mod = loadModule(compile(portalSource, "hydrate"), {
      signal,
      bindText,
      cursor,
      claimElement,
      claimText,
      skipNode,
      hydrateSlot,
    });
    mod.hydrate(container);
    expect(container.querySelector("button.m")).toBe(serverButton); // adopted in place

    // 4. End the pass → the deferred relocation flushes: the now-live button moves to <body>,
    //    exactly once (no duplicate), carrying its wired binding.
    endHydration();
    expect(serverButton.parentNode).toBe(document.body); // relocated to the default target
    expect(document.querySelectorAll("button.m").length).toBe(1); // moved, not copied

    // 5. Reactivity is live on the adopted-then-relocated node — the search-open click works.
    serverButton.click();
    expect(serverButton.textContent).toBe("c 1");

    // Cleanup: keep the shared document clean for sibling tests.
    serverButton.remove();
    container.remove();
  });

  // Guard the deferral primitive directly: `afterHydration` queues during a pass and flushes
  // (in order) at `endHydration`; outside a pass it runs synchronously.
  test("afterHydration defers during a pass and runs synchronously outside one", () => {
    const order = [];
    afterHydration(() => order.push("sync")); // not hydrating → immediate
    expect(order).toEqual(["sync"]);

    beginHydration();
    afterHydration(() => order.push("a"));
    afterHydration(() => order.push("b"));
    expect(order).toEqual(["sync"]); // still queued mid-pass
    endHydration();
    expect(order).toEqual(["sync", "a", "b"]); // flushed in FIFO order
  });
});

// ── Hydration construct matrix ────────────────────────────────────────────────
// Hydration correctness is combinatorial: every JSX construct emits a distinct SSG shape
// (its own markers) that the compiled adopt walk must round-trip exactly. The bugs we keep
// hitting live at *this seam* — SSG emits X, the walk expects Y — and the hand-written-HTML
// unit tests can't catch them, because they never run the real compiler for both halves.
//
// This table drives one source per construct through the real otfwc for *both* targets and
// asserts the three invariants that define correct first-paint hydration:
//   (1) SSG emits the expected marker shape,
//   (2) the adopt walk rebuilds NOTHING — every server element keeps its identity and the
//       element count is unchanged (no duplication, no re-creation), and
//   (3) a reactive change *after* adopt runs live on those same adopted nodes.
//
// To grow coverage, add a row. When a hydration bug is reported, the first step is to add the
// row that reproduces it (it should go red), then fix the runtime/compiler until it goes green.
describe.skipIf(!hasBin)("hydration construct matrix (ssg → hydrate, no rebuild)", () => {
  // One binding bag covering every helper any compiled construct imports; extra params are
  // harmless (loadModule injects by name, unused ones are just ignored).
  const ALL = {
    signal,
    bindText,
    bindAttr,
    bindChild,
    bindList,
    hydrateList,
    hydrateChild,
    hydrateSlot,
    cursor,
    claimElement,
    claimText,
    claimRegionStart,
    claimRegionEnd,
    skipNode,
    skipSlot,
    ssgText,
    ssgList,
    ssgComponent,
    defineSSG,
    attr,
  };

  const elementsIn = (root) => Array.from(root.querySelectorAll("*"));

  // SSG-render `source`, mount the server HTML, snapshot every server element, then adopt.
  function roundTrip(source) {
    const ssg = loadModule(compile(source, "ssg"), ALL).default;
    const html = ssg();
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverEls = elementsIn(container); // detached → child components don't upgrade
    const mod = loadModule(compile(source, "hydrate"), ALL);
    mod.hydrate(container);
    return { html, container, serverEls };
  }

  // The no-rebuild invariant: every server element still lives under the container (same node
  // object), and the adopt walk added no elements beside them (adopt reuses, never duplicates).
  function expectNoRebuild(serverEls, container) {
    for (const el of serverEls) expect(container.contains(el)).toBe(true);
    expect(elementsIn(container).length).toBe(serverEls.length);
  }

  // Each row: a source with a `.act` button whose click mutates state, then `check` asserts the
  // reactive result landed on the adopted DOM. `ssg` fragments assert the marker shape.
  const MATRIX = [
    {
      name: "text hole — updates the adopted text node in place",
      source:
        "export default function P(){ let n=$state(0);" +
        ' return <div><button class="act" onclick={() => n++}>+</button>' +
        ' <b class="probe">Count {n}</b></div>; }',
      ssg: ['<b class="probe">Count <!--$-->0<!--/--></b>'],
      check: (c) => {
        c.querySelector(".act").click();
        expect(c.querySelector(".probe").textContent).toBe("Count 1");
      },
    },
    {
      name: "two text holes in one element — both update independently",
      source:
        "export default function P(){ let a=$state(1), b=$state(2);" +
        ' return <div><button class="act" onclick={() => { a++; b++; }}>+</button>' +
        ' <p class="probe">{a} and {b}</p></div>; }',
      ssg: ['<p class="probe"><!--$-->1<!--/--> and <!--$-->2<!--/--></p>'],
      check: (c) => {
        c.querySelector(".act").click();
        expect(c.querySelector(".probe").textContent).toBe("2 and 3");
      },
    },
    {
      name: "reactive class binding — the Portal-search failure class, on the adopted element",
      source:
        "export default function P(){ let n=$state(0);" +
        ' return <div><button class="act" onclick={() => n++}>+</button>' +
        ' <b class={n > 0 ? "probe on" : "probe off"}>x</b></div>; }',
      check: (c) => {
        const probe = c.querySelector(".probe");
        expect(probe.classList.contains("off")).toBe(true); // server value adopted
        c.querySelector(".act").click();
        expect(probe.classList.contains("on")).toBe(true); // binding live on the same node
      },
    },
    {
      name: "list region — adopts server items, reconciles keeping their identity",
      source:
        "export default function P(){ let a=$state([1, 2, 3]);" +
        ' return <div><button class="act" onclick={() => a = [...a, 4]}>+</button>' +
        ' <ul class="probe">{a.map((x) => <li>{x}</li>)}</ul></div>; }',
      ssg: ["<!--[-->"], // region markers present
      check: (c) => {
        const before = Array.from(c.querySelectorAll("li"));
        expect(before.length).toBe(3);
        c.querySelector(".act").click();
        const after = Array.from(c.querySelectorAll("li"));
        expect(after.length).toBe(4); // reconciled, not rebuilt
        expect(after.slice(0, 3)).toEqual(before); // the three adopted nodes kept identity
        expect(after[3].textContent).toBe("4");
      },
    },
    {
      name: "conditional region — adopts the rendered branch, swaps on change",
      source:
        "export default function P(){ let f=$state(true);" +
        ' return <div><button class="act" onclick={() => f = !f}>t</button>' +
        ' <div class="probe">{f ? <p>Y</p> : <span>N</span>}</div></div>; }',
      ssg: ["<p>Y</p>"],
      checkHtml: (html) => expect(html).not.toContain("<span>N</span>"), // only active branch
      check: (c) => {
        const probe = c.querySelector(".probe");
        expect(probe.querySelector("p").textContent).toBe("Y");
        c.querySelector(".act").click();
        expect(probe.querySelector("p")).toBeNull();
        expect(probe.querySelector("span").textContent).toBe("N");
      },
    },
    {
      name: "component children slot — parent adopts the slotted content's reactivity",
      source:
        'function Card({ children }){ return <section class="card"><h1>C</h1>{children}</section>; }' +
        " export default function P(){ let n=$state(0);" +
        ' return <div><button class="act" onclick={() => n++}>+</button>' +
        ' <Card><b class="probe">v {n}</b></Card></div>; }',
      ssg: ["<!--c[web-card"], // component slot markers, labeled with the owning tag
      check: (c) => {
        c.querySelector(".act").click();
        expect(c.querySelector(".probe").textContent).toBe("v 1");
      },
    },
    {
      name: "passthrough built-in (ContextProvider) slot — the built-in-marker regression",
      source:
        'import { ContextProvider } from "@opentf/web";' +
        " export default function P(){ let n=$state(0);" +
        ' return <div><button class="act" onclick={() => n++}>+</button>' +
        ' <ContextProvider><b class="probe">c {n}</b></ContextProvider></div>; }',
      ssg: ["<web-internal-context-provider><!--c[web-internal-context-provider-->"], // built-in emits labeled slot markers now
      check: (c) => {
        c.querySelector(".act").click();
        expect(c.querySelector(".probe").textContent).toBe("c 1");
      },
    },
    {
      name: "nested component slots — inner slot's reactivity survives two adopt hops",
      source:
        'function Outer({ children }){ return <div class="outer">{children}</div>; }' +
        ' function Inner({ children }){ return <div class="inner">{children}</div>; }' +
        " export default function P(){ let n=$state(0);" +
        ' return <div><button class="act" onclick={() => n++}>+</button>' +
        ' <Outer><Inner><b class="probe">n {n}</b></Inner></Outer></div>; }',
      ssg: ["<!--c[web-outer", "<!--c[web-inner"],
      check: (c) => {
        c.querySelector(".act").click();
        expect(c.querySelector(".probe").textContent).toBe("n 1");
      },
    },
  ];

  for (const kase of MATRIX) {
    test(`construct: ${kase.name}`, () => {
      const { html, container, serverEls } = roundTrip(kase.source);
      for (const frag of kase.ssg || []) expect(html).toContain(frag);
      if (kase.checkHtml) kase.checkHtml(html);
      expectNoRebuild(serverEls, container);
      kase.check(container);
    });
  }

  // The DocsLayout shape that took down the docs site: a *component* whose view is a JSX-value
  // local containing a `{children}` slot, rendered through a `frame ? <shell>{body}</shell> :
  // body` dynamic node and used with `frame={false}` — so the bare `body.build()` branch is
  // the one `hydrateChild` evaluates.
  //
  // Two defects met here, both in the component's *adopt* branch (which the MATRIX above can't
  // reach — it keeps the container detached so component classes never upgrade):
  //   1. The value local's build fn re-slots the children local, but only the sibling `__build`
  //      closure declared it → `ReferenceError: __children is not defined`, killing the render.
  //   2. Declaring it isn't enough: `hydrateChild` evaluates the build template once purely to
  //      subscribe to its deps and discards the result, so a real rebuild there `appendChild`s
  //      the *live* slotted nodes into a throwaway tree — silently emptying the slot.
  const slotValueLocalSource =
    "export default function Panel(props){ const frame = props.frame === true;" +
    ' const body = <div class="b"><article class="slot">{props.children}</article></div>;' +
    ' return frame ? <div class="shell">{body}</div> : body; }';

  test("component adopt: a value local's `{children}` slot survives the subscribe-only build", () => {
    // 1. Server-render the component body with real slotted content, then wrap it in its host
    //    tag exactly as a parent's `ssgComponent` would.
    const ssgFn = loadComponent(compile(slotValueLocalSource, "ssg", true), "Panel_ssg", {
      signal,
      ssgText,
      defineSSG,
    });
    const inner = ssgFn({ frame: false }, '<b class="probe">HI</b>');
    expect(inner).toContain("<!--c[web-panel"); // the slot markers the adopt walk steps over
    expect(inner).toContain('<b class="probe">HI</b>');
    expect(inner).not.toContain('class="shell"'); // unframed: the bare `body` branch

    // 2. Build the host element from the compiled class and give it the server DOM.
    const Panel = loadComponent(compile(slotValueLocalSource, "hydrate", true), "PanelElement", {
      signal,
      bindText,
      bindChild,
      cursor,
      claimElement,
      claimText,
      skipNode,
      skipSlot,
      hydrateChild,
      hydrateHole,
      hydrationProps,
      isHydrating,
      runBuild,
      HydrationMismatch,
      reportError,
      handleError,
    });
    const host = new Panel();
    host.innerHTML = inner;
    const probe = host.querySelector(".probe");
    const serverBody = host.querySelector(".b");

    // 3. Connect inside the first-paint pass. The flag must be set *before* attaching: appending
    //    a defined custom element connects it synchronously, and connectedCallback is what picks
    //    adopt over build.
    const errors = [];
    const onError = (e) => errors.push(e.detail);
    window.addEventListener("otfw:error", onError);
    beginHydration();
    try {
      document.body.appendChild(host);
      if (!host._mounted) host.connectedCallback();
    } finally {
      endHydration();
      window.removeEventListener("otfw:error", onError);
    }

    try {
      // 4. The render completed — no `ReferenceError` swallowed by the component's error boundary.
      expect(errors).toEqual([]);
      // 5. It adopted rather than rebuilt: the server nodes kept their identity…
      expect(host.querySelector(".b")).toBe(serverBody);
      expect(host.querySelectorAll(".b").length).toBe(1);
      // …and the slotted content is still in the slot, not stolen into a discarded tree.
      expect(host.contains(probe)).toBe(true);
      expect(probe.parentNode).toBe(host.querySelector(".slot"));
    } finally {
      host.remove();
    }
  });
});
