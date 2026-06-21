import { afterEach, describe, expect, test } from "bun:test";

import { registerRoutes, routes } from "../runtime/router.js";
import { collectRoutePaths, renderToString } from "./render.js";

// An SSG page render fn (what the SSG backend emits): returns an HTML string.
function page(html) {
  return { default: (props) => (typeof html === "function" ? html(props) : html) };
}

afterEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
});

describe("server render (SSG, string-based)", () => {
  test("renderToString returns a matched route's HTML", async () => {
    registerRoutes({ "/app/about/page.jsx": page("<h1>About us</h1>") });
    expect(await renderToString("/about")).toBe("<h1>About us</h1>");
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

  test("collectRoutePaths returns static routes and skips param routes", async () => {
    registerRoutes({
      "/app/page.jsx": page("<i>h</i>"),
      "/app/about/page.jsx": page("<i>a</i>"),
      "/app/post/[id]/page.jsx": page("<i>p</i>"),
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.sort()).toEqual(["/", "/about"]);
    expect(skipped).toEqual(["/post/[id]"]);
  });

  test("collectRoutePaths expands a param route via getStaticPaths", async () => {
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: () => "<article/>",
        getStaticPaths: () => [{ params: { id: "1" } }, { params: { id: "2" } }],
      },
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.sort()).toEqual(["/post/1", "/post/2"]);
    expect(skipped).toEqual([]);
  });
});
