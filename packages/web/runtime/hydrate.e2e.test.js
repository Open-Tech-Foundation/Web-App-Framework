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
  beginHydrationCollect,
  defineSSG,
  endHydrationCollect,
  ssgComponent,
  ssgList,
  ssgText,
} from "../server/ssg-runtime.js";
import {
  __resetHydrationPayload,
  bindChild,
  bindList,
  bindText,
  claimElement,
  claimRegionEnd,
  claimRegionStart,
  claimText,
  cursor,
  hydrateChild,
  hydrateList,
  hydrationProps,
  skipNode,
} from "./index.js";

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
function compile(source, target) {
  const proc = Bun.spawnSync([OTFWC, "build", `--target=${target}`, "--stdin", "/app/page.tsx"], {
    stdin: new TextEncoder().encode(source),
  });
  if (proc.exitCode !== 0) throw new Error(`otfwc ${target} failed:\n${proc.stderr}`);
  return proc.stdout.toString();
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
});
