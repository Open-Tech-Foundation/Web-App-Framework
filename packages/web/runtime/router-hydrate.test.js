// The router's first-paint boot switch (Phase 2.0 — see docs/HYDRATION.md §3.4): when
// the server stamped `data-otfw-hydrate` on the root and the route module exposes a
// `hydrate` adopt factory, the router *adopts* the server DOM instead of rebuilding it;
// otherwise it falls back to a plain CSR build.

import { afterEach, describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { bindText } from "./dom.js";
import { claimElement, claimText, cursor, isHydrating, skipNode } from "./hydrate.js";
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
// factory (client navigation) + a `hydrate` adopt factory (first paint) using the real
// claim primitives. `calls` records which path the router took.
function makeModule(calls) {
  return {
    default() {
      calls.build = true;
      calls.hydratingDuringBuild = isHydrating(); // must be false on a client-nav build
      const d = document.createElement("div");
      d.textContent = "BUILT";
      return d;
    },
    hydrate(__root) {
      calls.hydrate = true;
      calls.hydratingDuringHydrate = isHydrating(); // flag must be live during adoption
      const n = signal(3);
      const c0 = cursor(__root);
      const div = claimElement(c0, "div");
      const c2 = cursor(div);
      const btn = claimElement(c2, "button");
      btn.onclick = () => n.value++;
      const c4 = cursor(btn);
      skipNode(c4); // "Count "
      const t = claimText(c4);
      bindText(t, () => n.value);
      return div;
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
});
