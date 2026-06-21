import { afterEach, describe, expect, test } from "bun:test";

import { registerRoutes, routes } from "../runtime/router.js";
import { collectRoutePaths, renderToString } from "./render.js";

// A page factory (what the compiler emits for page.jsx): returns a DOM node.
function page(text) {
  return { default: () => {
    const el = document.createElement("h1");
    el.textContent = text;
    return el;
  } };
}

afterEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
  globalThis.__OTFW_SSG__ = false;
});

describe("server render", () => {
  test("renderToString serializes a matched route's markup", async () => {
    globalThis.__OTFW_SSG__ = true;
    registerRoutes({ "/app/about/page.jsx": page("About us") });
    const html = await renderToString("/about");
    expect(html).toContain("<h1>About us</h1>");
  });

  test("wraps the page in its layout chain", async () => {
    globalThis.__OTFW_SSG__ = true;
    registerRoutes({
      "/app/layout.jsx": {
        default: ({ children }) => {
          const main = document.createElement("main");
          main.appendChild(children);
          return main;
        },
      },
      "/app/page.jsx": page("Home"),
    });
    const html = await renderToString("/");
    expect(html).toBe("<main><h1>Home</h1></main>");
  });

  test("falls back to the 404 page for an unmatched path; null with no 404", async () => {
    globalThis.__OTFW_SSG__ = true;
    expect(await renderToString("/missing")).toBe(null);
    registerRoutes({ "/app/404.jsx": page("Not found") });
    expect(await renderToString("/missing")).toContain("Not found");
  });

  test("collectRoutePaths returns static routes and skips param routes", async () => {
    registerRoutes({
      "/app/page.jsx": page("Home"),
      "/app/about/page.jsx": page("About"),
      "/app/post/[id]/page.jsx": page("Post"),
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.sort()).toEqual(["/", "/about"]);
    expect(skipped).toEqual(["/post/[id]"]);
  });

  test("collectRoutePaths expands a param route via getStaticPaths", async () => {
    registerRoutes({
      "/app/post/[id]/page.jsx": {
        default: () => document.createElement("article"),
        getStaticPaths: () => [{ params: { id: "1" } }, { params: { id: "2" } }],
      },
    });
    const { paths, skipped } = await collectRoutePaths();
    expect(paths.sort()).toEqual(["/post/1", "/post/2"]);
    expect(skipped).toEqual([]);
  });
});
