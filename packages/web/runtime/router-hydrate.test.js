// The router's first-paint boot switch (Phase 2.0 — see docs/HYDRATION.md §3.4): when
// the server stamped `data-otfw-hydrate` on the root and the route module exposes a
// `hydrate` adopt factory, the router *adopts* the server DOM instead of rebuilding it;
// otherwise it falls back to a plain CSR build.

import { afterEach, describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { bindText } from "./dom.js";
import {
  beginHydration,
  claimElement,
  claimRegionEnd,
  claimRegionStart,
  claimText,
  cursor,
  isHydrating,
  skipNode,
} from "./hydrate.js";
import { mountApp, registerRoutes, routes } from "./router.js";

afterEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

const SERVER_HTML = '<div class="box"><button>Count <!--$-->3<!--/--></button></div>';

// A stand-in for what the compiler emits for the hydrate target: a `default` build
// factory (client navigation) + a `hydrateAt` adopt factory (first paint, over a cursor —
// so nested routes adopt at their layout's slot) + a `hydrate` wrapper. Uses the real claim
// primitives. `calls` records which path the router took.
function makeModule(calls) {
  return {
    default() {
      calls.build = true;
      calls.hydratingDuringBuild = isHydrating(); // must be false on a client-nav build
      const d = document.createElement("div");
      d.textContent = "BUILT";
      return d;
    },
    hydrateAt(c0) {
      calls.hydrate = true;
      calls.hydratingDuringHydrate = isHydrating(); // flag must be live during adoption
      const n = signal(3);
      const div = claimElement(c0, "div"); // c0 is the cursor the router threads in
      const c2 = cursor(div);
      const btn = claimElement(c2, "button");
      btn.onclick = () => n.value++;
      const c4 = cursor(btn);
      skipNode(c4); // "Count "
      const t = claimText(c4);
      bindText(t, () => n.value);
      return div;
    },
    hydrate(__root) {
      return this.hydrateAt(cursor(__root));
    },
  };
}

function serverRoot(withSentinel) {
  const root = document.createElement("div");
  root.id = "app";
  if (withSentinel) root.setAttribute("data-otfw-hydrate", "");
  root.innerHTML = SERVER_HTML; // the server-rendered markup, as the browser parsed it
  document.body.appendChild(root);
  if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
  window.history.replaceState({}, "", "/");
  return root;
}

describe("router boot — hydrate vs build", () => {
  test("adopts the server DOM via the module's hydrate factory when the sentinel is present", async () => {
    const calls = {};
    registerRoutes({ "/proj/app/page.jsx": makeModule(calls) });
    const root = serverRoot(true);
    const serverDiv = root.firstChild;
    const serverButton = serverDiv.firstChild;
    const serverText = serverButton.childNodes[2]; // "Count ", <!--$-->, "3", <!--/-->

    await mountApp({ target: root });

    expect(calls.hydrate).toBe(true);
    expect(calls.hydratingDuringHydrate).toBe(true); // flag live while adopting
    expect(isHydrating()).toBe(false); // …and cleared once first paint resolves
    expect(calls.build).toBeUndefined(); // never rebuilt
    expect(root.firstChild).toBe(serverDiv); // adopted in place — same node
    expect(serverDiv.firstChild).toBe(serverButton);
    expect(root.querySelectorAll("button").length).toBe(1); // no duplicate
    expect(serverText.data).toBe("3"); // no flash/reset

    serverButton.click();
    expect(serverText.data).toBe("4"); // reactivity is live on the adopted node
    expect(serverButton.childNodes[2]).toBe(serverText); // identity unchanged
  });

  test("threads one cursor through a layout chain — layout + page both adopt (2.1c)", async () => {
    const calls = { order: [] };
    // A layout `<main class="shell"><nav>N</nav>{children}</main>` whose slot is a region.
    // Its hydrateAt claims its own structure, then hands its cursor to the children thunk.
    const layout = {
      default: ({ children }) => {
        const m = document.createElement("main");
        if (children) m.appendChild(children);
        return m;
      },
      hydrateAt(c0, props) {
        calls.order.push("layout");
        const main = claimElement(c0, "main");
        const c2 = cursor(main);
        claimElement(c2, "nav"); // static <nav>N</nav>
        claimRegionStart(c2);
        props.children(c2); // adopt the nested page inline, advancing c2 past it
        claimRegionEnd(c2);
        return main;
      },
      hydrate(root, props) {
        return this.hydrateAt(cursor(root), props);
      },
    };
    const pageCalls = {};
    registerRoutes({
      "/proj/app/layout.jsx": layout,
      "/proj/app/page.jsx": makeModule(pageCalls),
    });
    // Wrap makeModule's page so its adopt records order too.
    const page = routes.pages["/"];
    const origAt = page.hydrateAt.bind(page);
    page.hydrateAt = (c, props) => (calls.order.push("page"), origAt(c, props));

    const root = document.createElement("div");
    root.id = "app";
    root.setAttribute("data-otfw-hydrate", "");
    root.innerHTML =
      '<main class="shell"><nav>N</nav><!--[-->' +
      SERVER_HTML +
      "<!--]--></main>";
    document.body.appendChild(root);
    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");

    const serverMain = root.firstChild;
    const serverPageDiv = root.querySelector(".box");
    const serverButton = serverPageDiv.firstChild;
    const serverText = serverButton.childNodes[2];

    await mountApp({ target: root });

    // Both layers adopted in place — nothing rebuilt, same nodes.
    expect(calls.order).toEqual(["layout", "page"]); // outer walk runs, page adopts at the slot
    expect(pageCalls.build).toBeUndefined();
    expect(root.firstChild).toBe(serverMain);
    expect(root.querySelector(".box")).toBe(serverPageDiv);
    expect(root.querySelectorAll("main, button").length).toBe(2); // no duplication
    expect(serverText.data).toBe("3");

    // Reactivity is live on the adopted (nested) page node.
    serverButton.click();
    expect(serverText.data).toBe("4");
  });

  test("falls back to a CSR build when a layout in the chain isn't adoptable", async () => {
    const calls = {};
    // Page is adoptable, but its layout has no hydrateAt → the whole chain rebuilds.
    registerRoutes({
      "/proj/app/layout.jsx": { default: ({ children }) => { const m = document.createElement("main"); if (children) m.appendChild(children); return m; } },
      "/proj/app/page.jsx": makeModule(calls),
    });
    const root = document.createElement("div");
    root.id = "app";
    root.setAttribute("data-otfw-hydrate", "");
    root.innerHTML = '<main><!--[-->' + SERVER_HTML + "<!--]--></main>";
    document.body.appendChild(root);
    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");

    await mountApp({ target: root });

    expect(calls.hydrate).toBeUndefined(); // never adopted
    expect(calls.build).toBe(true); // rebuilt via CSR instead
  });

  test("falls back to a CSR build when the sentinel is absent", async () => {
    const calls = {};
    registerRoutes({ "/proj/app/page.jsx": makeModule(calls) });
    const root = serverRoot(false);
    const serverDiv = root.firstChild;

    await mountApp({ target: root });

    expect(calls.build).toBe(true);
    expect(calls.hydratingDuringBuild).toBe(false); // a build never runs under the flag
    expect(calls.hydrate).toBeUndefined();
    expect(root.firstChild).not.toBe(serverDiv); // server DOM was replaced
    expect(root.textContent).toContain("BUILT");
  });

  test("falls back to a build when the route has no hydrate factory (CSR-only module)", async () => {
    const calls = {};
    // A module with only a build factory (e.g. a page the hydrate target couldn't adopt).
    registerRoutes({
      "/proj/app/page.jsx": {
        default() {
          calls.build = true;
          calls.hydratingDuringBuild = isHydrating();
          const d = document.createElement("div");
          d.textContent = "BUILT";
          return d;
        },
      },
    });
    const root = serverRoot(true); // sentinel present, but no hydrate export
    await mountApp({ target: root });

    expect(calls.build).toBe(true);
    // The flag was set for the import but cleared before the CSR fallback build runs, so a
    // freshly-built component would build (not try to re-adopt an empty host).
    expect(calls.hydratingDuringBuild).toBe(false);
    expect(isHydrating()).toBe(false);
    expect(root.textContent).toContain("BUILT");
  });

  test("a guard redirect on first paint leaves hydration before the target route builds", async () => {
    // The server rendered `/`; a route guard redirects to `/docs` at boot. The target route
    // must build fresh — its server DOM is the *previous* route's — so the first-paint flag
    // has to be cleared before that build. It used to survive: this path returns before the
    // `hydrate && match` block that clears it, so the flag stayed true for the rest of the
    // session and every island the build created took the adopt arm against DOM its own
    // parent had just created (`expected a region start marker, found <div>` on the live
    // js-std site — and the same on every SPA navigation after it).
    const calls = {};
    registerRoutes({
      "/proj/app/page.jsx": makeModule({}),
      "/proj/app/docs/page.jsx": {
        default() {
          calls.build = true;
          calls.hydratingDuringBuild = isHydrating();
          const d = document.createElement("div");
          d.textContent = "DOCS";
          return d;
        },
      },
    });
    const root = serverRoot(true); // sentinel + `/` server markup
    // In a browser the flag is seeded `true` at hydrate.js module load, from the sentinel in
    // the already-parsed HTML (docs/HYDRATION.md §3.4) — that's what makes it leak. happy-dom
    // imports the module against an empty document, so seed it here or the test can't see the
    // bug at all (it passed against the unfixed router until this line existed).
    beginHydration();

    await mountApp({
      target: root,
      guard: (to, { next, redirect }) => (to.pathname === "/" ? redirect("/docs") : next()),
    });
    await new Promise((r) => setTimeout(r, 0)); // the redirect navigation is async

    expect(calls.build).toBe(true); // the target route built…
    expect(calls.hydratingDuringBuild).toBe(false); // …with hydration already left
    expect(isHydrating()).toBe(false); // and the flag doesn't leak into later navigations
    expect(root.textContent).toContain("DOCS");
  });
});
