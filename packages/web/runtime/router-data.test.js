// Loader data on the client (docs/DATA.md): `navigate` fetches `<path>/__data.json`
// for routes registered via `registerLoaderRoutes` and exposes the result as the
// reactive `router.data` — resolved before the navigation commits.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { onError } from "../core/errors.js";
import {
  mountApp,
  navigate,
  registerLoaderRoutes,
  router,
  routes,
  setRouteData,
} from "./router.js";
import { __resetInlineRouteData, dataUrlFor, readInlineRouteData } from "./route-data.js";

function page(label) {
  return () => {
    const d = document.createElement("div");
    d.textContent = label;
    return d;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const realFetch = globalThis.fetch;
let fetched; // URLs the router requested

beforeEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
  routes.loaderRoutes = new Set();
  fetched = [];
  __resetInlineRouteData();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
  setRouteData(undefined);
});

// Mount a small app: `/` (loader-less), `/todos` and `/items/[id]` (loaders).
async function mountFixture() {
  const app = document.createElement("div");
  document.body.appendChild(app);
  const pages = {
    "/proj/app/page.jsx": { default: page("home") },
    "/proj/app/plain/page.jsx": { default: page("plain") },
    "/proj/app/todos/page.jsx": { default: page("todos") },
    "/proj/app/items/[id]/page.jsx": { default: page("item") },
  };
  if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
  window.history.replaceState({}, "", "/");
  mountApp({ pages, target: app, loaders: ["/todos", "/items/[id]"] });
  await tick();
  return app;
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("dataUrlFor", () => {
  test("maps page paths to their data URLs", () => {
    expect(dataUrlFor("/")).toBe("/__data.json");
    expect(dataUrlFor("/todos")).toBe("/todos/__data.json");
    expect(dataUrlFor("/todos/", "?q=1")).toBe("/todos/__data.json?q=1");
  });
});

describe("navigate + loader data", () => {
  test("fetches the data URL for a loader route and exposes router.data", async () => {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return jsonResponse({ items: ["alpha"] });
    };
    const app = await mountFixture();
    await navigate("/todos?q=1");
    expect(fetched).toEqual(["/todos/__data.json?q=1"]);
    expect(router.data).toEqual({ items: ["alpha"] });
    expect(app.textContent).toContain("todos");
  });

  test("a loader-less route never fetches and resets stale data", async () => {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return jsonResponse({ items: [] });
    };
    await mountFixture();
    await navigate("/todos");
    expect(router.data).toEqual({ items: [] });
    await navigate("/plain");
    expect(fetched).toEqual(["/todos/__data.json"]); // only the loader route fetched
    expect(router.data).toBe(undefined); // previous route's data is gone
  });

  test("mountApp registers loaders; dynamic patterns match by route", async () => {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return jsonResponse({ id: "7" });
    };
    await mountFixture();
    await navigate("/items/7");
    expect(fetched).toEqual(["/items/7/__data.json"]);
    expect(router.data).toEqual({ id: "7" });
  });

  test("a 404 from the endpoint commits with data === undefined", async () => {
    globalThis.fetch = async () => new Response("null", { status: 404 });
    const app = await mountFixture();
    await navigate("/todos");
    expect(router.data).toBe(undefined);
    expect(app.textContent).toContain("todos"); // navigation still committed
  });

  test("a failed fetch is reported and the navigation commits", async () => {
    const reports = [];
    const off = onError((e, ctx) => reports.push({ e, ctx }));
    globalThis.fetch = async () => new Response("boom", { status: 500 });
    const app = await mountFixture();
    await navigate("/todos");
    off();
    expect(reports.length).toBe(1);
    expect(reports[0].ctx.phase).toBe("data");
    expect(router.data).toBe(undefined);
    expect(app.textContent).toContain("todos");
  });

  test("a superseded navigation's late data never wins (nav sequence)", async () => {
    let releaseSlow;
    const slow = new Promise((r) => (releaseSlow = r));
    globalThis.fetch = async (url) => {
      if (String(url).startsWith("/todos/")) {
        await slow;
        return jsonResponse({ from: "todos" });
      }
      return jsonResponse({ from: "item" });
    };
    const app = await mountFixture();
    const first = navigate("/todos"); // hangs on its data fetch
    await navigate("/items/1"); // newer nav wins
    expect(router.data).toEqual({ from: "item" });
    releaseSlow();
    await first;
    await tick();
    expect(router.pathname).toBe("/items/1"); // the stale nav did not commit
    expect(router.data).toEqual({ from: "item" });
    expect(app.textContent).toContain("item");
  });

  test("first paint over server HTML reads the inline payload instead of fetching", async () => {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return jsonResponse({ from: "network" });
    };
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "__otfw_data";
    script.textContent = JSON.stringify({ from: "inline" });
    document.body.appendChild(script);
    __resetInlineRouteData();

    await mountFixture();
    fetched = [];
    // The router's hydrate branch (no hydrateAt exports → falls back to a CSR
    // build) must still have sourced data from the inline payload, not the network.
    await navigate("/todos", true, true, true);
    expect(router.data).toEqual({ from: "inline" });
    expect(fetched).toEqual([]);
    script.remove();
  });
});

describe("readInlineRouteData", () => {
  test("no script → undefined; parses and caches when present", () => {
    expect(readInlineRouteData()).toBe(undefined);
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "__otfw_data";
    script.textContent = '{"a":1}';
    document.body.appendChild(script);
    expect(readInlineRouteData()).toBe(undefined); // cached miss until reset
    __resetInlineRouteData();
    expect(readInlineRouteData()).toEqual({ a: 1 });
    script.remove();
    __resetInlineRouteData();
  });
});

describe("registerLoaderRoutes", () => {
  test("replaces the set; null clears it", () => {
    registerLoaderRoutes(["/a", "/b"]);
    expect(routes.loaderRoutes.has("/a")).toBe(true);
    registerLoaderRoutes(null);
    expect(routes.loaderRoutes.size).toBe(0);
  });
});
