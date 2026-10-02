import { afterEach, beforeEach, describe, expect, test } from "runtime:test";

import { configureI18n, localizePath, registerRoutes, router, routes, setRouteState } from "../runtime/router.js";
import { defineSSG, ssgComponent } from "./ssg-runtime.js";
import { collectRoutePaths, renderRoute, renderToString } from "./render.js";

// An SSG page render fn (what the SSG backend emits): returns an HTML string.
function page(html) {
  return { default: (props) => (typeof html === "function" ? html(props) : html) };
}

// The route table is a module singleton shared with the client router, so a sibling
// suite that registers routes/layouts and doesn't clean up would otherwise leak into
// the *first* test here (e.g. a leftover root layout wrapping this page's HTML, breaking
// an exact-equality assertion). Reset before each test too — not just after — so this
// suite is isolated regardless of which file bun ran before it.
const resetRoutes = () => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
};
beforeEach(resetRoutes);
afterEach(resetRoutes);

describe("server render (SSG, string-based)", () => {
  test("concurrent lazy pages and layouts keep router state and hydration props separate", async () => {
    defineSSG("web-request", () => "island");
    const island = (where) => ssgComponent("web-request", { where, id: router.params.id, token: router.data.token }, "");
    registerRoutes({
      "/app/post/[id]/page.jsx": async () => page(() =>
        `<article>${router.pathname}|${router.params.id}|${router.query.q}|${router.data.token}${island("page")}</article>`),
      "/app/layout.jsx": async () => ({
        default: ({ children }) => `<main>${router.params.id}|${router.data.token}${children}${island("layout")}</main>`,
      }),
    });
    const results = await Promise.all(["A", "B"].map((id) =>
      renderRoute(`/post/${id}`, null, `?q=query-${id}`, { data: { token: `token-${id}` } })));
    for (const [index, id] of ["A", "B"].entries()) {
      const result = results[index];
      expect(result.html).toContain(`<main>${id}|token-${id}`);
      expect(result.html).toContain(`/post/${id}|${id}|query-${id}|token-${id}`);
      expect(result.html).toContain('data-h="0"');
      expect(result.html).toContain('data-h="1"');
      expect(JSON.parse(result.hydration)).toEqual([
        { where: "page", id, token: `token-${id}` },
        { where: "layout", id, token: `token-${id}` },
      ]);
    }
  });

  test("async metadata keeps request state across awaits without changing ambient router state", async () => {
    setRouteState({ pathname: "/ambient", search: "?q=ambient", params: { id: "ambient" }, data: "ambient" });
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: () => "<p>Post</p>",
        async generateMetadata() {
          const before = router.params.id;
          await new Promise((resolve) => setTimeout(resolve, before === "A" ? 10 : 0));
          return { title: `${before}|${router.params.id}|${router.query.q}|${router.data.token}` };
        },
      },
    });
    const [a, b] = await Promise.all([
      renderRoute("/post/A", null, "?q=one", { data: { token: "token-A" } }),
      renderRoute("/post/B", null, "?q=two", { data: { token: "token-B" } }),
    ]);
    expect(a.metadata.title).toBe("A|A|one|token-A");
    expect(b.metadata.title).toBe("B|B|two|token-B");
    expect(router.pathname).toBe("/ambient");
    expect(router.params).toEqual({ id: "ambient" });
    expect(router.query).toEqual({ q: "ambient" });
    expect(router.data).toBe("ambient");
    setRouteState();
  });

  test("concurrent locales remain separate in router getters and localized links", async () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    try {
      registerRoutes({
        "/app/post/[id]/page.jsx": {
          default: () => `<p>${router.locale}|${localizePath("/about")}</p>`,
          async generateMetadata() {
            await new Promise((resolve) => setTimeout(resolve, 0));
            return { title: `${router.locale}|${localizePath("/about")}` };
          },
        },
      });
      const [en, fr] = await Promise.all([renderRoute("/post/A"), renderRoute("/fr/post/B")]);
      expect(en.html).toBe("<p>en|/about</p>");
      expect(fr.html).toBe("<p>fr|/fr/about</p>");
      expect(en.metadata.title).toBe("en|/about");
      expect(fr.metadata.title).toBe("fr|/fr/about");
      expect(router.locale).toBe("en");
    } finally {
      configureI18n(null);
    }
  });

  test("failed page and metadata renders do not leak state or hydration into other renders", async () => {
    defineSSG("web-failure-probe", () => "island");
    const island = () => ssgComponent("web-failure-probe", { token: router.data.token }, "");
    const ambient = router.pathname;
    registerRoutes({
      "/app/bad-page/page.jsx": page(() => { island(); throw Error("page failed"); }),
      "/app/bad-metadata/page.jsx": {
        default: island,
        async generateMetadata() { await Promise.resolve(); throw Error("metadata failed"); },
      },
      "/app/good/page.jsx": page(island),
    });
    const [badPage, badMetadata, good] = await Promise.allSettled([
      renderRoute("/bad-page", null, "", { data: { token: "bad-page" } }),
      renderRoute("/bad-metadata", null, "", { data: { token: "bad-metadata" } }),
      renderRoute("/good", null, "", { data: { token: "good" } }),
    ]);
    expect(badPage.status).toBe("rejected");
    expect(badPage.reason.message).toBe("page failed");
    expect(badMetadata.status).toBe("rejected");
    expect(badMetadata.reason.message).toBe("metadata failed");
    expect(good.status).toBe("fulfilled");
    expect(JSON.parse(good.value.hydration)).toEqual([{ token: "good" }]);
    expect(good.value.html).toContain('data-h="0"');
    expect(router.pathname).toBe(ambient);
    const outside = ssgComponent("web-failure-probe", { token: "outside" }, "");
    expect(outside).toContain("data-hp=");
    expect(outside).not.toContain("data-h=");
    expect(JSON.parse((await renderRoute("/good", null, "", { data: { token: "next" } })).hydration))
      .toEqual([{ token: "next" }]);
  });

  test("nested renders restore their parent's route state and keep island payloads separate", async () => {
    defineSSG("web-nested-probe", () => "island");
    let nested;
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: () => ssgComponent("web-nested-probe", { id: router.params.id, token: router.data.token }, ""),
        async generateMetadata() {
          if (router.params.id === "outer") {
            nested = await renderRoute("/post/inner", null, "", { data: { token: "inner" } });
          }
          return { title: `${router.params.id}|${router.data.token}` };
        },
      },
    });
    const outer = await renderRoute("/post/outer", null, "", { data: { token: "outer" } });
    expect(outer.metadata.title).toBe("outer|outer");
    expect(nested.metadata.title).toBe("inner|inner");
    expect(JSON.parse(outer.hydration)).toEqual([{ id: "outer", token: "outer" }]);
    expect(JSON.parse(nested.hydration)).toEqual([{ id: "inner", token: "inner" }]);
    expect(outer.html).toContain('data-h="0"');
    expect(nested.html).toContain('data-h="0"');
  });

  test("cached module-level JSX keeps inline props independent of route hydration ids", async () => {
    defineSSG("web-module-probe", () => "island");
    let module;
    registerRoutes({
      "/app/page.jsx": async () => {
        module ??= page(ssgComponent("web-module-probe", { value: "cached" }, ""));
        return module;
      },
    });
    for (const result of await Promise.all([renderRoute("/"), renderRoute("/")])) {
      expect(result.html).toContain("data-hp=");
      expect(result.html).not.toContain("data-h=");
      expect(result.hydration).toBe("");
    }
  });

  test("renderToString returns a matched route's HTML", async () => {
    registerRoutes({ "/app/about/page.jsx": page("<h1>About us</h1>") });
    expect(await renderToString("/about")).toBe("<h1>About us</h1>");
  });

  test("renderRoute returns the island hydration payload (data-h ids + rich props)", async () => {
    // A page composing a component the way compiled SSG output does — via ssgComponent,
    // which the collector observes during the render.
    defineSSG("web-badge", (p) => `<span>${p.meta.text}</span>`);
    registerRoutes({
      "/app/page.jsx": {
        default: () => `<div>${ssgComponent("web-badge", { meta: { text: "hi", n: 7 } }, "")}</div>`,
      },
    });
    const result = await renderRoute("/");
    expect(result.html).toMatch(/<web-badge[^>]*\bdata-h="0"/); // host keyed for hydration
    expect(result.html).not.toContain("meta="); // rich prop not a host attribute
    expect(JSON.parse(result.hydration)).toEqual([{ meta: { text: "hi", n: 7 } }]);
  });

  test("renderRoute yields an empty payload for a page with no islands", async () => {
    registerRoutes({ "/app/page.jsx": page("<h1>Home</h1>") });
    expect((await renderRoute("/")).hydration).toBe("");
  });

  test("wraps the page HTML in its layout chain", async () => {
    registerRoutes({
      "/app/layout.jsx": { default: ({ children }) => `<main>${children}</main>` },
      "/app/page.jsx": page("<h1>Home</h1>"),
    });
    expect(await renderToString("/")).toBe("<main><h1>Home</h1></main>");
  });

  test("a page can read route params via props", async () => {
    registerRoutes({ "/app/post/[id]/page.jsx": page((p) => `<article>${p.params.id}</article>`) });
    expect(await renderToString("/post/42")).toBe("<article>42</article>");
  });

  test("falls back to the 404 page; null when there is none", async () => {
    expect(await renderToString("/missing")).toBe(null);
    registerRoutes({ "/app/404.jsx": page("<p>Not found</p>") });
    expect(await renderToString("/missing")).toBe("<p>Not found</p>");
  });

  test("renderRoute returns html + resolved metadata, with params for dynamic routes", async () => {
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: (p) => `<article>${p.params.id}</article>`,
        generateMetadata: ({ params }) => ({ title: `Post ${params.id}` }),
      },
    });
    const result = await renderRoute("/post/7", { id: "7" });
    expect(result.html).toBe("<article>7</article>");
    expect(result.metadata.title).toBe("Post 7");
  });

  test("renderRoute reports status 200 for a matched route", async () => {
    registerRoutes({ "/app/about/page.jsx": page("<h1>About</h1>") });
    const result = await renderRoute("/about");
    expect(result.status).toBe(200);
    expect(result.html).toBe("<h1>About</h1>");
  });

  test("renderRoute reports status 404 when a path falls back to the 404 page", async () => {
    registerRoutes({ "/app/404.jsx": page("<p>Not found</p>") });
    const result = await renderRoute("/missing");
    // The 404 page still renders (so the server can return a real page) but the
    // status flags the miss so the SSR server sends HTTP 404.
    expect(result.status).toBe(404);
    expect(result.html).toBe("<p>Not found</p>");
  });

  test("renderRoute returns null when there is no match and no 404 page", async () => {
    registerRoutes({ "/app/page.jsx": page("<h1>Home</h1>") });
    expect(await renderRoute("/missing")).toBe(null);
  });

  test("renderRoute exposes options.data to the page as router.data", async () => {
    registerRoutes({
      "/app/todos/page.jsx": page(() => `<ul>${router.data.items.join(",")}</ul>`),
    });
    const result = await renderRoute("/todos", null, "", { data: { items: ["a", "b"] } });
    expect(result.html).toBe("<ul>a,b</ul>");
  });

  test("a render without data resets router.data (no stale carry-over)", async () => {
    registerRoutes({
      "/app/todos/page.jsx": page(() => `<i>${String(router.data)}</i>`),
    });
    await renderRoute("/todos", null, "", { data: { x: 1 } });
    expect(await renderToString("/todos")).toBe("<i>undefined</i>");
  });

  test("collectRoutePaths returns {path, params}; skips param routes without getStaticPaths", async () => {
    registerRoutes({
      "/app/page.jsx": page("<i>h</i>"),
      "/app/about/page.jsx": page("<i>a</i>"),
      "/app/post/[id]/page.jsx": page("<i>p</i>"),
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.map((p) => p.path).sort()).toEqual(["/", "/about"]);
    expect(paths.every((p) => typeof p.params === "object")).toBe(true);
    expect(skipped).toEqual(["/post/[id]"]);
  });

  test("collectRoutePaths expands a param route via getStaticPaths, carrying params", async () => {
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: () => "<article/>",
        getStaticPaths: () => [{ params: { id: "1" } }, { params: { id: "2" } }],
      },
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.map((p) => p.path).sort()).toEqual(["/post/1", "/post/2"]);
    expect(paths.find((p) => p.path === "/post/1").params).toEqual({ id: "1" });
    expect(skipped).toEqual([]);
  });
});
