import { describe, expect, test } from "bun:test";

import {
  configureI18n,
  localizePath,
  matchRoute,
  mountApp,
  navigate,
  resolveLocale,
  router,
  setLocale,
} from "./router.js";

// A page factory returning a labelled node. `__lifecycle` is exercised via mount.
function page(label) {
  return () => {
    const d = document.createElement("div");
    d.textContent = label;
    return d;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("router", () => {
  test("registers routes, matches dynamic params, swaps on navigation", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    const pages = {
      "/proj/app/page.jsx": { default: page("home") },
      // lazy loader form (code-split route)
      "/proj/app/about/page.jsx": () =>
        Promise.resolve({ default: page("about") }),
      "/proj/app/post/[id]/page.jsx": { default: page("post") },
      "/proj/app/shop/[...slug]/page.jsx": { default: page("shop") },
      "/proj/app/404.jsx": { default: page("missing") },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");
    mountApp({ pages, target: app });
    await tick();

    expect(app.textContent).toContain("home");
    expect(router.pathname).toBe("/");

    await navigate("/about");
    expect(app.textContent).toContain("about");
    expect(router.pathname).toBe("/about");

    await navigate("/post/42");
    expect(app.textContent).toContain("post");
    expect(router.params.id).toBe("42");

    await navigate("/shop/clothing/shirts");
    expect(app.textContent).toContain("shop");
    expect(router.params.slug).toEqual(["clothing", "shirts"]);

    await navigate("/does-not-exist");
    expect(app.textContent).toContain("missing"); // 404 page

    await navigate("/about?q=1");
    expect(router.query.q).toBe("1");
  });

  test("route guard receives pathname, fullPath, params, and query", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    const pages = {
      "/proj/app/page.jsx": { default: page("home") },
      "/proj/app/post/[id]/page.jsx": { default: page("post") },
    };

    const seen = [];
    const guard = (to, { next }) => {
      seen.push(to);
      next();
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");
    mountApp({ pages, target: app, guard });
    await tick();

    await navigate("/post/42?q=1#frag");
    const to = seen.at(-1);
    expect(to.pathname).toBe("/post/42");
    expect(to.path).toBe("/post/42"); // back-compat alias
    expect(to.fullPath).toBe("/post/42?q=1#frag");
    expect(to.params.id).toBe("42");
    expect(to.query.q).toBe("1");
  });

  test("composes layouts and passes params/children", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    // A page that reads its params, and a root layout that wraps children.
    const postPage = (props) => {
      const d = document.createElement("article");
      d.textContent = `post ${props.params.id}`;
      return d;
    };
    const rootLayout = (props) => {
      const shell = document.createElement("div");
      shell.className = "layout";
      const main = document.createElement("main");
      if (props.children) main.appendChild(props.children);
      shell.appendChild(main);
      return shell;
    };

    const pages = {
      "/proj2/app/layout.jsx": { default: rootLayout },
      "/proj2/app/post/[id]/page.jsx": { default: postPage },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/post/7");
    mountApp({ pages, target: app });
    await tick();

    // Layout wraps the page; params reached the page.
    expect(app.querySelector(".layout main article")?.textContent).toBe("post 7");
  });

  // A lazy loader that rejects the way a browser reports a failed dynamic import of a
  // content-hashed route chunk ("Failed to fetch dynamically imported module: <url>").
  const chunkError = () =>
    Promise.reject(
      new TypeError(
        "Failed to fetch dynamically imported module: https://x/assets/layout-DmM9YRKj.js",
      ),
    );

  const CHUNK_RELOAD_FLAG = "otfw:chunk-reloaded";
  const clearReloadFlag = () => window.sessionStorage.removeItem(CHUNK_RELOAD_FLAG);

  test("failed route chunk (redeploy) → one full reload for fresh assets", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);
    const pages = {
      "/proj3/app/page.jsx": { default: page("home") },
      "/proj3/app/stale/page.jsx": chunkError,
    };

    let reloads = 0;
    const origReload = window.location.reload;
    window.location.reload = () => {
      reloads++;
    };
    clearReloadFlag();

    try {
      if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
      window.history.replaceState({}, "", "/");
      mountApp({ pages, target: app });
      await tick();

      await navigate("/stale");
      expect(reloads).toBe(1);
      expect(app.innerHTML).not.toContain("Failed to load");
    } finally {
      window.location.reload = origReload;
      clearReloadFlag();
    }
  });

  test("persistent failure after the reload → one reload, then the error (no loop)", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);
    const pages = {
      "/proj5/app/page.jsx": { default: page("home") },
      "/proj5/app/broken/page.jsx": chunkError,
    };

    let reloads = 0;
    const origReload = window.location.reload;
    window.location.reload = () => {
      reloads++;
    };
    clearReloadFlag();

    try {
      if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
      window.history.replaceState({}, "", "/");
      mountApp({ pages, target: app });
      await tick();

      // First failure: reload once (guard flag now set, survives the mocked reload).
      await navigate("/broken");
      expect(reloads).toBe(1);

      // The post-reload attempt still fails: the guard blocks a second reload and the
      // error surfaces instead of looping.
      await navigate("/broken");
      expect(reloads).toBe(1);
      expect(app.innerHTML).toContain("Failed to load");
    } finally {
      window.location.reload = origReload;
      clearReloadFlag();
    }
  });

  test("page + layout chunks download concurrently, not one after another", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    // Each lazy entry records when its "download" starts and finishes. Serial loading
    // would show start(n) only after finish(n-1); concurrent loading interleaves them.
    const events = [];
    const chunk = (name, factory) => () => {
      events.push(`start:${name}`);
      return new Promise((resolve) =>
        setTimeout(() => {
          events.push(`end:${name}`);
          resolve({ default: factory });
        }, 10),
      );
    };
    const wrap = (cls) => (props) => {
      const d = document.createElement("div");
      d.className = cls;
      d.appendChild(props.children);
      return d;
    };

    // Layouts are scoped under /docs (never the root) — `routes.layouts` is module
    // state shared across tests, and a root layout here would wrap every other test's
    // home page.
    const pages = {
      "/proj6/app/docs/layout.jsx": chunk("outer-layout", wrap("outer")),
      "/proj6/app/docs/intro/layout.jsx": chunk("inner-layout", wrap("inner")),
      "/proj6/app/docs/intro/page.jsx": chunk("page", page("intro")),
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/docs/intro");
    window.history.replaceState({}, "", "/docs/intro");
    mountApp({ pages, target: app });
    await new Promise((r) => setTimeout(r, 50));

    // All three started before any finished — one round trip, not three stacked.
    expect(events).toHaveLength(6);
    expect(events.slice(0, 3).every((e) => e.startsWith("start:"))).toBe(true);
    // …and the layout chain still composes outermost-first around the page.
    expect(app.querySelector(".outer .inner")?.textContent).toBe("intro");
  });

  test("a chunk failure still surfaces even when a sibling chunk fails too", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);
    const pages = {
      "/proj7/app/page.jsx": { default: page("home") },
      // Both the page and its layout 404 — the redeploy case, where every stale chunk
      // fails. The second rejection must not escape as an unhandled rejection.
      "/proj7/app/stale/layout.jsx": chunkError,
      "/proj7/app/stale/page.jsx": chunkError,
    };

    const unhandled = [];
    const onUnhandled = (e) => {
      unhandled.push(e);
      e.preventDefault?.();
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    let reloads = 0;
    const origReload = window.location.reload;
    window.location.reload = () => {
      reloads++;
    };
    clearReloadFlag();

    try {
      if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
      window.history.replaceState({}, "", "/");
      mountApp({ pages, target: app });
      await tick();

      await navigate("/stale");
      await tick();
      expect(reloads).toBe(1); // recognized as a chunk-load error, recovery still runs
      expect(unhandled).toHaveLength(0);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.location.reload = origReload;
      clearReloadFlag();
    }
  });
});

describe("i18n locale routing (prefix_except_default)", () => {
  test("resolveLocale strips non-default prefix; default stays bare", () => {
    configureI18n({ locales: ["en", "fr", "ja"], defaultLocale: "en" });

    // default locale: no prefix, path passes through
    expect(resolveLocale("/about")).toEqual({ locale: "en", path: "/about" });
    expect(resolveLocale("/")).toEqual({ locale: "en", path: "/" });

    // non-default locale: stripped, recorded
    expect(resolveLocale("/fr/about")).toEqual({ locale: "fr", path: "/about" });
    expect(resolveLocale("/ja")).toEqual({ locale: "ja", path: "/" });

    // a route whose first segment isn't a locale is left alone
    expect(resolveLocale("/enterprise")).toEqual({ locale: "en", path: "/enterprise" });

    configureI18n(null); // reset for other tests
  });

  test("localizePath prefixes non-default, keeps default bare, replaces existing", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });

    expect(localizePath("/about", "fr")).toBe("/fr/about");
    expect(localizePath("/about", "en")).toBe("/about"); // default bare
    expect(localizePath("/", "fr")).toBe("/fr");
    expect(localizePath("/fr/about", "en")).toBe("/about"); // existing prefix replaced
    expect(localizePath("/en/about", "fr")).toBe("/fr/about");

    configureI18n(null);
  });

  test("matchRoute resolves a prefixed URL to the locale-agnostic route", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    // matchRoute reads the live `routes` table; the previous suite registered "/about".
    const m = matchRoute("/fr/about");
    expect(m?.route).toBe("/about");
    configureI18n(null);
  });

  test("navigation updates router.locale and serves one route table for all locales", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    const pages = {
      "/i18n/app/page.jsx": { default: page("home") },
      "/i18n/app/about/page.jsx": { default: page("about") },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");
    mountApp({ pages, target: app, i18n: { locales: ["en", "fr"], defaultLocale: "en" } });
    await tick();

    expect(router.locale).toBe("en");
    expect(app.textContent).toContain("home");

    await navigate("/fr/about");
    expect(router.locale).toBe("fr");
    expect(app.textContent).toContain("about"); // same route module, French URL
    expect(router.pathname).toBe("/fr/about");

    await navigate("/about");
    expect(router.locale).toBe("en");
    expect(app.textContent).toContain("about");

    configureI18n(null);
  });

  test("setLocale sets the active locale without navigating", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    setLocale("fr");
    expect(router.locale).toBe("fr");
    setLocale("en");
    expect(router.locale).toBe("en");
    configureI18n(null);
  });
});
